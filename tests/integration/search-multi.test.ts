/**
 * Filters with several values (grade=P-3&grade=P-4, where=kenya&where=uganda) and typo-tolerant
 * search ("finanse" → "Finance Officer", "Did you mean finance?") against a THROWAWAY database
 * (TEST_DATABASE_URL; tables are emptied). Skipped without one, like the other integration tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("several values per filter, and typos (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let jobs: typeof import("@/lib/jobs");
  let countFor: typeof import("@/lib/landing").countFor;
  let trgm = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql.unsafe("truncate jobs, job_sources, organizations restart identity cascade");
    jobs = await import("@/lib/jobs");
    countFor = (await import("@/lib/landing")).countFor;
    trgm = (await sql`select 1 from pg_extension where extname = 'pg_trgm'`).length > 0;

    const [un] = await sql`insert into organizations (slug, name, short_name, org_type) values ('wfp', 'World Food Programme', 'WFP', 'UN system') returning id`;
    const [io] = await sql`insert into organizations (slug, name, short_name, org_type) values ('oecd', 'Organisation for Economic Co-operation and Development', 'OECD', 'International organization') returning id`;
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const rows: [string, number, string, string, string, string | null][] = [
      // title, org, country_code, location_text, category, grade
      ["Finance Officer", un.id, "KE", "Nairobi, Kenya", "finance", "P-3"],
      ["Procurement Specialist", un.id, "UG", "Kampala, Uganda", "procurement-logistics", "P-4"],
      ["Programme Assistant", un.id, "ET", "Addis Ababa, Ethiopia", "programme-management", "G-5"],
      ["Economist", io.id, "FR", "Paris, France", "policy-research", null],
      ["Logistics Officer", un.id, "SS", "Juba, South Sudan", "procurement-logistics", "NO-B"],
    ];
    for (const [i, [title, org, cc, loc, cat, grade]] of rows.entries()) {
      await sql`
        insert into jobs (slug, title, organization_id, country_code, location_text, category, grade, apply_url, apply_host, url_hash, deadline)
        values (${`job-${i}`}, ${title}, ${org}, ${cc}, ${loc}, ${cat}, ${grade}, ${`https://example.org/${i}`}, 'example.org', ${`hash-${i}`}, ${future})`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  const titles = async (f: Parameters<typeof jobs.searchJobs>[0]) => (await jobs.searchJobs(f, 50, { looseFallback: true })).items.map((j) => j.title).sort();

  it("matches any of several places, countries and regions together", async () => {
    expect(await titles({ country: ["kenya", "uganda"] })).toEqual(["Finance Officer", "Procurement Specialist"]);
    expect(await titles({ country: ["france"], region: ["africa"] })).toEqual(["Economist", "Finance Officer", "Logistics Officer", "Procurement Specialist", "Programme Assistant"]);
    expect(await titles(jobs.parseFilters({ where: ["kenya", "region-europe-central-asia"] }))).toEqual(["Economist", "Finance Officer"]);
    expect(await countFor({ country: ["kenya", "uganda", "france"] })).toBe(3);
  });

  it("matches any of several grades, groups and single grades", async () => {
    expect(await titles({ grade: ["P-3", "P-4"] })).toEqual(["Finance Officer", "Procurement Specialist"]);
    expect(await titles({ grade: ["NO", "G"] })).toEqual(["Logistics Officer", "Programme Assistant"]);
    expect(await titles({ grade: ["P-3"], country: ["kenya", "uganda"] })).toEqual(["Finance Officer"]);
  });

  it("counts options and removals with several values in use", async () => {
    const f = await jobs.filteredFacets({ grade: ["P-3", "P-4"], country: ["kenya", "ethiopia"] });
    // Kenya or Ethiopia, P-3 or P-4 → Finance Officer. Without the place: 2; without the grade: 2.
    expect(f.without).toEqual({ where: 2, grade: 2 });
    expect(f.grades.map((g) => g.grade).sort()).toEqual(["G-5", "P-3"]);
    expect(f.countries.find((c) => c.slug === "uganda")?.count).toBe(1);
  });

  it("finds titles with a misspelt word when nothing matches exactly", async () => {
    if (!trgm) return; // the database has no pg_trgm: no typo tolerance (migration 011)
    const res = await jobs.searchJobs({ q: "finanse" }, 20, { looseFallback: true });
    expect(res.matchMode).toBe("any");
    expect(res.items.map((j) => j.title)).toEqual(["Finance Officer"]);
    expect((await jobs.searchJobs({ q: "finanse" })).total).toBe(0);
    expect(await titles({ q: "procurment" })).toEqual(["Procurement Specialist"]);
  });

  it("suggests the closest word for a misspelt search (with or without pg_trgm: computed in the app)", async () => {
    jobs.resetSuggestionVocabulary();
    expect(await jobs.searchSuggestion("finanse")).toEqual({ q: "finance", words: ["finance"] });
    expect(await jobs.searchSuggestion("procurment kenya")).toEqual({ q: "procurement kenya", words: ["procurement"] });
    expect(await jobs.searchSuggestion("finance")).toBeNull();
    expect(await jobs.searchSuggestion("qqqqqqq")).toBeNull();
    expect(await jobs.searchSuggestion(undefined)).toBeNull();
  });

  it("keeps the words in memory: a listing added since shows up only once the cache is renewed", async () => {
    jobs.resetSuggestionVocabulary();
    expect(await jobs.searchSuggestion("hydrologst")).toBeNull();
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await sql`
      insert into jobs (slug, title, country_code, location_text, category, apply_url, apply_host, url_hash, deadline)
      values ('job-hydro', 'Hydrologist', 'KE', 'Nairobi, Kenya', 'environment', 'https://example.org/hydro', 'example.org', 'hash-hydro', ${future})`;
    try {
      expect(await jobs.searchSuggestion("hydrologst")).toBeNull(); // still the cached words
      jobs.resetSuggestionVocabulary();
      expect(await jobs.searchSuggestion("hydrologst")).toEqual({ q: "hydrologist", words: ["hydrologist"] });
    } finally {
      await sql`delete from jobs where slug = 'job-hydro'`;
      jobs.resetSuggestionVocabulary();
    }
  });

  it("computes the same similarity as pg_trgm", async () => {
    if (!trgm) return; // nothing to compare with
    const pairs = [["finanse", "finance"], ["procurment", "procurement"], ["economist", "economics"], ["logistcs", "logistics"], ["abc", "xyz"], ["programme", "program"], ["officer", "office"], ["a1b2c3", "a1b2c4"]];
    for (const [a, b] of pairs) {
      const [{ s }] = await sql`select pb_similarity(${a}, ${b})::float8 as s`;
      expect(jobs.trigramSimilarity(jobs.wordTrigrams(a), jobs.wordTrigrams(b))).toBeCloseTo(s, 5);
    }
  });
});
