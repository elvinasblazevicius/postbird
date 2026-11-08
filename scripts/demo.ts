/**
 * Demo data for local development ONLY.
 *   npm run demo:seed   imports demo/demo-feed.xml through the real importer
 *   npm run demo:clear  deletes every demo listing
 * Demo listings use made-up organizations, are labelled "Demo data" on every
 * page, are excluded from the sitemap and search engines, and the script
 * refuses to run against a production database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getSql } from "../src/lib/db";
import { normalizeItem } from "../src/lib/feeds/extract";
import { parseFeed } from "../src/lib/feeds/parse";

async function main() {
  const sql = getSql();
  const cmd = process.argv[2];
  const url = process.env.DATABASE_URL ?? "";
  if (cmd === "seed" && !/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DEMO_DATA !== "yes") {
    console.error("Refusing to add demo data to a non-local database. Set ALLOW_DEMO_DATA=yes if you really mean it.");
    process.exit(1);
  }
  if (cmd === "clear") {
    const rows = await sql`delete from jobs where is_demo returning id`;
    await sql`delete from organizations o where not exists (select 1 from jobs j where j.organization_id = o.id)`;
    console.log(`Removed ${rows.length} demo listings.`);
    return sql.end();
  }
  if (cmd !== "seed") {
    console.log("Usage: demo.ts seed | clear");
    return sql.end();
  }
  const feed = parseFeed(readFileSync(path.join(process.cwd(), "demo", "demo-feed.xml"), "utf8"));
  let n = 0;
  for (const [i, item] of feed.items.entries()) {
    // Spread publish dates and deadlines around today so the demo looks current.
    const published = new Date(Date.now() - (i % 9) * 86_400_000 - i * 3_600_000);
    const deadline = new Date(Date.now() + ((i * 5) % 40 + 2) * 86_400_000).toISOString().slice(0, 10);
    item.published = published.toISOString();
    item.summaryHtml = (item.summaryHtml ?? "") + `<p>Closing date: ${deadline}</p>`;
    const j = normalizeItem(item, { id: 0, name: "demo", defaultOrganization: null, contentPolicy: "excerpt" });
    const [org] = j.organization
      ? await sql<{ id: number }[]>`insert into organizations (slug, name, short_name, org_type) values (${j.organization.slug}, ${j.organization.name}, ${j.organization.short}, ${"NGO"})
          on conflict (slug) do update set name = excluded.name returning id`
      : [null];
    await sql`
      insert into jobs (slug, title, organization_id, country_code, city, location_text, is_remote, category, job_type, grade,
        languages, min_experience_years, summary, content_policy, apply_url, apply_host, url_hash, fingerprint, published_at, deadline, is_demo)
      values (${j.slug}, ${j.title}, ${org?.id ?? null}, ${j.countryCode}, ${j.city}, ${j.locationText}, ${j.isRemote}, ${j.category},
        ${j.jobType}, ${j.grade}, ${j.languages}, ${j.minExperienceYears}, ${j.summary}, 'excerpt', ${j.applyUrl}, ${j.applyHost}, ${j.urlHash}, null, ${j.publishedAt}, ${j.deadline}, true)
      on conflict (url_hash) do nothing`;
    n++;
  }
  console.log(`Added ${n} demo listings (marked as demo data).`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
