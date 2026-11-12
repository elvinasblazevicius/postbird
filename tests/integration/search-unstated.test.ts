/**
 * Several organizations in one search, filters read from the posting's text that also take listings
 * which don't state the detail (unstated=1), language words in the search, "Recently posted" and an
 * organization's posting mix, against a THROWAWAY database (TEST_DATABASE_URL; tables are emptied).
 * Skipped without one, like the other integration tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("several organizations and unstated details (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let jobs: typeof import("@/lib/jobs");
  let saved: typeof import("@/lib/saved-searches");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql.unsafe("truncate jobs, job_sources, organizations restart identity cascade");
    jobs = await import("@/lib/jobs");
    saved = await import("@/lib/saved-searches");

    const org = async (slug: string, name: string, short: string | null, type: string) =>
      (await sql`insert into organizations (slug, name, short_name, org_type) values (${slug}, ${name}, ${short}, ${type}) returning id`)[0].id as number;
    const wfp = await org("wfp", "World Food Programme", "WFP", "UN system");
    const unicef = await org("unicef", "UNICEF", "UNICEF", "UN system");
    const nrc = await org("nrc", "Norwegian Refugee Council", "NRC", "NGO");
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    // title, org, grade, job_type, languages, desirable, experience, days ago posted, deadline
    const rows: [string, number, string | null, string | null, string[] | null, string[] | null, number | null, number, string][] = [
      ["Finance Officer", wfp, "P-3", "Fixed-term", ["French"], null, 5, 1, future],
      ["Data Analyst", wfp, null, null, null, null, null, 2, future],
      ["Programme Officer (P)", unicef, null, "Fixed-term", null, ["Spanish"], 3, 3, future],
      ["Protection Consultant", nrc, null, "Consultancy", ["Arabic"], null, null, 4, future],
      ["Driver", nrc, "G-3", "Temporary", null, null, 2, 5, future],
      ["Old Logistics Officer", wfp, "P-2", "Fixed-term", null, null, 2, 30, past],
    ];
    for (const [i, [title, o, grade, type, langs, desirable, exp, ago, deadline]] of rows.entries()) {
      await sql`
        insert into jobs (slug, title, organization_id, category, grade, job_type, languages, desirable_languages, min_experience_years,
          apply_url, apply_host, url_hash, deadline, published_at, first_seen_at)
        values (${`job-${i}`}, ${title}, ${o}, 'other', ${grade}, ${type}, ${langs}, ${desirable}, ${exp},
          ${`https://example.org/${i}`}, 'example.org', ${`hash-${i}`}, ${deadline},
          now() - make_interval(days => ${ago}), now() - make_interval(days => ${ago}))`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  const titles = async (f: Parameters<typeof jobs.searchJobs>[0]) => (await jobs.searchJobs(f, 50)).items.map((j) => j.title).sort();

  it("matches any of several organizations, and counts them for the filter", async () => {
    expect(await titles(jobs.parseFilters({ org: ["wfp", "nrc"] }))).toEqual(["Data Analyst", "Driver", "Finance Officer", "Protection Consultant"]);
    const f = await jobs.filteredFacets({ org: ["wfp", "unicef"] });
    expect(f.without.org).toBe(5);
    expect(f.orgs.map((o) => [o.slug, o.count])).toEqual([["nrc", 2], ["wfp", 2], ["unicef", 1]]);
    expect(await jobs.getOrganizations(["wfp", "nope", "nrc"])).toEqual([
      { slug: "wfp", name: "World Food Programme", short_name: "WFP" },
      { slug: "nrc", name: "Norwegian Refugee Council", short_name: "NRC" },
    ]);
    expect(await saved.describeSearch("org=wfp&org=nrc")).toBe("at Norwegian Refugee Council or World Food Programme");
  });

  it("adds the listings that don't state the detail with unstated", async () => {
    // A grade, or a grade group in the title ("(P)"), counts as stated.
    expect(await titles({ grade: ["P"] })).toEqual(["Finance Officer", "Programme Officer (P)"]);
    expect(await titles({ grade: ["P"], unstated: true })).toEqual(["Data Analyst", "Finance Officer", "Programme Officer (P)", "Protection Consultant"]);
    expect(await jobs.countJobs({ grade: ["P"], unstated: true })).toBe(4);
    expect(await titles({ type: ["Consultancy"], unstated: true })).toEqual(["Data Analyst", "Protection Consultant"]);
    expect(await titles({ exp: ["3-5"], unstated: true })).toEqual(["Data Analyst", "Finance Officer", "Programme Officer (P)", "Protection Consultant"]);
    // A desirable language counts as stated language requirements.
    expect(await titles({ lang: ["French"], unstated: true })).toEqual(["Data Analyst", "Driver", "Finance Officer"]);
    // Several at once: each filter takes the listings that don't state its own detail.
    expect(await titles({ grade: ["P"], type: ["Fixed-term"], unstated: true })).toEqual(["Data Analyst", "Finance Officer", "Programme Officer (P)"]);
  });

  it("reads a language in the search words as the language filter", async () => {
    expect(await titles({ q: "french" })).toEqual(["Finance Officer"]);
    expect(await titles({ q: "arabic consultant" })).toEqual(["Protection Consultant"]);
    expect(await titles({ q: "french", unstated: true })).toEqual(["Data Analyst", "Driver", "Finance Officer"]);
  });

  it("lists recently posted listings purely newest first", async () => {
    expect((await jobs.latestJobs(3)).map((j) => j.title)).toEqual(["Finance Officer", "Data Analyst", "Programme Officer (P)"]);
  });

  it("gives an organization's usual contract types and grades, closed recent listings included", async () => {
    const mix = await jobs.organizationPostingMix("wfp");
    expect(mix.total).toBe(3);
    expect(mix.types).toEqual([{ k: "Fixed-term", n: 2 }]);
    expect(mix.grades).toEqual([{ k: "P-2", n: 1 }, { k: "P-3", n: 1 }]);
    expect((await jobs.organizationPostingMix("unicef")).grades).toEqual([{ k: "P", n: 1 }]);
  });
});
