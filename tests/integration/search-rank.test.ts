/**
 * The "any word" fallback's order, and "More in {category}" on job pages, against a THROWAWAY
 * database (TEST_DATABASE_URL; tables are emptied). Skipped without one.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("loose search order and similar vacancies (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let jobs: typeof import("@/lib/jobs");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql.unsafe("truncate jobs, job_sources, organizations restart identity cascade");
    jobs = await import("@/lib/jobs");

    const org = async (slug: string, name: string, type: string) =>
      (await sql`insert into organizations (slug, name, short_name, org_type) values (${slug}, ${name}, ${slug.toUpperCase()}, ${type}) returning id`)[0].id;
    const iom = await org("iom", "International Organization for Migration", "UN system");
    const who = await org("who", "World Health Organization", "UN system");
    const wb = await org("world-bank", "World Bank Group", "International financial institution");
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    // Nothing is called "Finance Officer", so "finance officer" falls back to any word.
    // The newest listings are the officers, so date order alone would put them first.
    const rows: [string, number, string, string | null, string | null, number][] = [
      // title, org, category, grade, country, days ago
      ["Finance Assistant", who, "finance", "G-5", "CH", 6],
      // Another category: only the start of the word ("financ…") finds it.
      ["Financing Specialist", wb, "environment-climate-energy", "GG", "US", 5],
      ["Programme Officer", iom, "programme-management", "P-3", "KE", 1],
      ["Logistics Officer", iom, "procurement-logistics", "P-2", "KE", 1],
      ["Protection Officer", who, "protection-humanitarian-affairs", "P-3", "JO", 1],
      ["Health Officer", who, "health", "P-3", "CH", 1],
      ["Data Officer", iom, "data-analytics", "P-2", "KE", 1],
      ["Budget Analyst", iom, "finance", "P-2", "KE", 2],
      ["Budget Assistant", iom, "finance", "G-5", "UG", 3],
      ["Treasury Analyst", wb, "finance", "GF", "US", 4],
      // Oldest, but the same grade group (P) and region (Africa) as Budget Analyst.
      ["Audit Specialist", who, "finance", "P-3", "UG", 7],
    ];
    for (const [i, [title, o, cat, grade, cc, ago]] of rows.entries()) {
      const at = new Date(Date.now() - ago * 86_400_000 - i * 60_000);
      await sql`
        insert into jobs (slug, title, organization_id, category, grade, country_code, apply_url, apply_host, url_hash, deadline, status, published_at, first_seen_at)
        values (${`r-${i}`}, ${title}, ${o}, ${cat}, ${grade}, ${cc}, ${`https://example.org/r/${i}`}, 'example.org', ${`r-hash-${i}`}, ${future}, 'active', ${at}, ${at})`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("puts listings with the rarer word first when no listing has every word", async () => {
    const r = await jobs.searchJobs({ q: "finance officer" }, 50, { looseFallback: true });
    expect(r.matchMode).toBe("any");
    const titles = r.items.map((j) => j.title);
    // "finance" (also the start of "Financing") is in fewer titles than "officer": the jobs with it in the title come first,
    // then the officers, then the other finance-category jobs (the word only matches their category).
    expect(titles.slice(0, 2).sort()).toEqual(["Finance Assistant", "Financing Specialist"]);
    expect(titles.slice(2, 7).every((t) => t.endsWith("Officer"))).toBe(true);
    expect(titles.slice(7).sort()).toEqual(["Audit Specialist", "Budget Analyst", "Budget Assistant", "Treasury Analyst"]);
  });

  it("matches the start of longer words in the fallback only", async () => {
    expect(jobs.loosePrefix("finance")).toBe("financ");
    expect(jobs.loosePrefix("officer")).toBe("officer");
    expect(jobs.loosePrefix("monitoring")).toBe("monitor");
    expect(jobs.loosePrefix("data")).toBeNull();
    // The normal search still needs the word itself (or its category).
    expect((await jobs.searchJobs({ q: "finance" }, 50)).items.map((j) => j.title)).not.toContain("Financing Specialist");
  });

  it("lists more in the category at other organizations, the same grade group and region first", async () => {
    const [budget] = await sql`select id from jobs where title = 'Budget Analyst'`;
    const job = (await jobs.getJob(Number(budget.id)))!;
    const more = await jobs.moreInCategory(job);
    const titles = more.map((j) => j.title);
    // Same organization (IOM's Budget Assistant) is left out: the page links to its other vacancies instead.
    expect(titles).not.toContain("Budget Assistant");
    expect(titles).not.toContain("Budget Analyst");
    expect(titles[0]).toBe("Audit Specialist");
    expect(new Set(titles.slice(1))).toEqual(new Set(["Finance Assistant", "Treasury Analyst"]));
    expect(more.every((j) => j.category === "finance" && j.org_slug !== "iom")).toBe(true);
  });
});
