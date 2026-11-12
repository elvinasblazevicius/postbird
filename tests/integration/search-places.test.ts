/**
 * Duty-station aliases, "Best match" order, grade groups from IOM titles, required-only language
 * filter and the home page's week counts, against a THROWAWAY database (TEST_DATABASE_URL; tables
 * are emptied). Skipped without one.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("places, best match, grade groups and languages (database)", () => {
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

    const org = async (slug: string, name: string, short: string | null, type: string | null) =>
      (await sql`insert into organizations (slug, name, short_name, org_type) values (${slug}, ${name}, ${short}, ${type}) returning id`)[0].id;
    const iom = await org("iom", "International Organization for Migration", "IOM", "UN system");
    const osce = await org("osce", "OSCE", "OSCE", "International organization");
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const old = new Date(Date.now() - 20 * 86_400_000);
    // title, org, city, country, location text, grade, languages, desirable, published
    const rows: [string, number, string | null, string | null, string | null, string | null, string[] | null, string[] | null, Date | null][] = [
      ["Legal Officer (P)", iom, "Genève", "CH", "Genève, Suisse", null, null, ["French"], null],
      ["Data Analyst", iom, "Geneva", "CH", "Geneva, Switzerland", "P-3", ["French"], null, old],
      ["Driver (G)", iom, "Kyiv", "UA", "Kyiv, Ukraine", null, null, null, null],
      ["Programme Assistant", osce, null, "NL", "Den Haag", "G-5", null, null, null],
      ["Roma Inclusion Officer", osce, "Skopje", "MK", "Skopje", null, null, null, null],
      ["Finance Officer", iom, "Rome", "IT", "Rome, Italy", "P-2", null, null, null],
      ["Senior Geneva Data Analyst Lead", iom, "Nairobi", "KE", "Nairobi", null, null, null, old],
    ];
    for (const [i, [title, o, city, cc, loc, grade, langs, desirable, published]] of rows.entries()) {
      await sql`
        insert into jobs (slug, title, organization_id, city, country_code, location_text, grade, languages, desirable_languages, published_at,
                          apply_url, apply_host, url_hash, deadline, status)
        values (${`p-${i}`}, ${title}, ${o}, ${city}, ${cc}, ${loc}, ${grade}, ${langs}, ${desirable}, ${published},
                ${`https://example.org/p/${i}`}, 'example.org', ${`p-hash-${i}`}, ${future}, 'active')`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  const titles = async (f: Parameters<typeof jobs.searchJobs>[0]) => (await jobs.searchJobs(f, 50, { looseFallback: true })).items.map((j) => j.title).sort();

  it("finds duty stations by their other names and spellings", async () => {
    // The other name matches where the job is, not a title that mentions the city.
    expect(await titles({ q: "geneve" })).toEqual(["Data Analyst", "Legal Officer (P)"]);
    expect(await titles({ q: "Genève legal" })).toEqual(["Legal Officer (P)"]);
    expect(await titles({ q: "kiev" })).toEqual(["Driver (G)"]);
    expect(await titles({ q: "the hague" })).toEqual(["Programme Assistant"]);
    expect(await titles({ q: "den haag" })).toEqual(["Programme Assistant"]);
    // Another name matches the location only: "Roma" in a title is not Rome.
    expect(await titles({ q: "rome" })).toEqual(["Finance Officer"]);
  });

  it("orders keyword results by best match, newest first among equals, and keeps Newest on request", async () => {
    const best = await jobs.searchJobs({ q: "geneva data" }, 50);
    expect(best.sort).toBe("relevance");
    expect(best.items.map((j) => j.title)).toEqual(["Senior Geneva Data Analyst Lead", "Data Analyst"]);
    const newest = await jobs.searchJobs({ q: "geneva data", sort: "newest" }, 50);
    expect(newest.sort).toBe("newest");
    expect(jobs.jobsUrl({ q: "geneva data", sort: "newest" })).toBe("/jobs?q=geneva+data&sort=newest");
    expect(jobs.jobsUrl({ sort: "newest" })).toBe("/jobs");
  });

  it("counts IOM's (P) and (G) titles under their grade group, once", async () => {
    expect(await titles({ grade: ["P"] })).toEqual(["Data Analyst", "Finance Officer", "Legal Officer (P)"]);
    expect(await titles({ grade: ["G"] })).toEqual(["Driver (G)", "Programme Assistant"]);
    const f = await jobs.filteredFacets({});
    const count = (g: string) => f.grades.find((x) => x.grade === g)?.count ?? 0;
    expect(count("P")).toBe(1);
    expect(count("P-3")).toBe(1);
    expect(count("G")).toBe(1);
    expect(count("G-5")).toBe(1);
  });

  it("filters by required languages only", async () => {
    expect(await titles({ lang: ["French"] })).toEqual(["Data Analyst"]);
    const job = await jobs.getJob((await jobs.searchJobs({ q: "legal" }, 5)).items[0].id);
    expect(job?.desirable_languages).toEqual(["French"]);
  });

  it("counts the past week's open vacancies for the home page", async () => {
    const week = await jobs.weekInReview();
    expect(week.total).toBe(5);
    expect(week.types).toEqual([{ type: "UN system", count: 3 }, { type: "International organization", count: 2 }]);
    expect(week.orgs.map((o) => [o.slug, o.count])).toEqual([["iom", 3], ["osce", 2]]);
  });
});
