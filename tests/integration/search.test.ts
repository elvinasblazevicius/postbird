/**
 * Job search against a THROWAWAY database (TEST_DATABASE_URL; tables are emptied).
 * Skipped without one, like the other integration tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("job search (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let jobs: typeof import("@/lib/jobs");
  let countFor: typeof import("@/lib/landing").countFor;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql.unsafe("truncate jobs, job_sources, organizations restart identity cascade");
    jobs = await import("@/lib/jobs");
    countFor = (await import("@/lib/landing")).countFor;

    const [unicef] = await sql`insert into organizations (slug, name, short_name, org_type) values ('unicef', 'United Nations Children''s Fund', 'UNICEF', 'UN system') returning id`;
    const [ngo] = await sql`insert into organizations (slug, name, short_name, org_type) values ('helpers', 'Helpers International', null, 'NGO') returning id`;
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const rows: [string, number, string | null, string, string, string | null, string, string][] = [
      // title, org, country_code, location_text, category, grade, deadline, status
      ["Regional WASH Specialist", unicef.id, "KE", "Nairobi, Kenya; Kampala, Uganda", "programme-management", "P-4", future, "active"],
      ["National Health Officer", unicef.id, "KE", "Kisumu, Kenya", "health", "NO-B", future, "active"],
      ["Field Assistant", ngo.id, "UG", "Gulu, Uganda", "administration", "NPSA-6", future, "active"],
      ["Humanitarian Coordinator", ngo.id, "SD", "Khartoum, Sudan", "programme-management", "D-1", future, "active"],
      ["Logistics Officer", ngo.id, "SS", "Juba, South Sudan", "procurement-logistics", "P-3", future, "active"],
      ["Data Officer", unicef.id, "KE", "Nairobi, Kenya", "data-analytics", "P-2", past, "active"],
      ["Statistician", ngo.id, null, "Home-based", "data-analytics", null, future, "active"],
    ];
    for (const [i, [title, org, cc, loc, cat, grade, deadline, status]] of rows.entries()) {
      await sql`
        insert into jobs (slug, title, organization_id, country_code, location_text, category, grade, apply_url, apply_host, url_hash, deadline, status)
        values (${`job-${i}`}, ${title}, ${org}, ${cc}, ${loc}, ${cat}, ${grade}, ${`https://example.org/${i}`}, 'example.org', ${`hash-${i}`}, ${deadline}, ${status})`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  const titles = async (f: Parameters<typeof jobs.searchJobs>[0]) => (await jobs.searchJobs(f, 50, { looseFallback: true })).items.map((j) => j.title).sort();

  it("matches a country named in the location text, not only the country column", async () => {
    expect(await titles({ country: "uganda" })).toEqual(["Field Assistant", "Regional WASH Specialist"]);
    expect(await titles({ q: "jobs in uganda" })).toEqual(["Field Assistant", "Regional WASH Specialist"]);
    // "South Sudan" is not "Sudan".
    expect(await titles({ country: "sudan" })).toEqual(["Humanitarian Coordinator"]);
    expect(await countFor({ country: "uganda" })).toBe(2);
  });

  it("counts a listing under every country it names, and once per region", async () => {
    const countries = await jobs.countryFacets();
    expect(countries.find((c) => c.slug === "kenya")?.count).toBe(2);
    expect(countries.find((c) => c.slug === "uganda")?.count).toBe(2);
    expect(countries.find((c) => c.slug === "sudan")?.count).toBe(1);
    expect((await jobs.regionFacets()).find((r) => r.slug === "africa")?.count).toBe(5);
  });

  it("matches organization short names and category names", async () => {
    expect(await titles({ q: "unicef health" })).toEqual(["National Health Officer"]);
    expect(await titles({ q: "procurement" })).toEqual(["Logistics Officer"]);
  });

  it("falls back to any word when no listing has them all, and says so", async () => {
    const strict = await jobs.searchJobs({ q: "statistician zzzz" });
    expect(strict.total).toBe(0);
    expect(strict.matchMode).toBe("all");
    const loose = await jobs.searchJobs({ q: "statistician zzzz" }, 20, { looseFallback: true });
    expect(loose.matchMode).toBe("any");
    expect(loose.items.map((j) => j.title)).toEqual(["Statistician"]);
    const none = await jobs.searchJobs({ q: "yyyy zzzz" }, 20, { looseFallback: true });
    expect(none.total).toBe(0);
    expect(none.matchMode).toBe("all");
  });

  it("hides local-only posts and filters by grade group or single grade", async () => {
    expect(await titles({ country: "kenya", hidelocal: true })).toEqual(["Regional WASH Specialist"]);
    expect(await titles({ grade: "SC" })).toEqual(["Field Assistant"]);
    expect(await titles({ grade: "P" })).toEqual(["Logistics Officer", "Regional WASH Specialist"]);
    expect(await titles({ grade: "P-3" })).toEqual(["Logistics Officer"]);
  });

  it("gives option counts for the other filters and the count without each filter", async () => {
    const f = await jobs.filteredFacets({ country: "kenya", grade: "D-1" });
    expect(f.without).toEqual({ where: 1, grade: 2 });
    expect(f.grades.map((g) => g.grade).sort()).toEqual(["NO-B", "P-4"]);
    expect(f.countries.find((c) => c.slug === "sudan")?.count).toBe(1);
    expect(f.countries.find((c) => c.slug === "kenya")).toBeUndefined();
  });
});
