/**
 * The cases the November 2026 search audit found wrong on the live site, each with the vacancy
 * titles it named. Runs against a THROWAWAY database (TEST_DATABASE_URL; tables are emptied).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("search audit cases (database)", () => {
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

    const org = async (slug: string, name: string, short: string | null, type: string) =>
      (await sql`insert into organizations (slug, name, short_name, org_type) values (${slug}, ${name}, ${short}, ${type}) returning id`)[0].id as number;
    const who = await org("who", "World Health Organization", "WHO", "UN system");
    const unicef = await org("unicef", "United Nations Children's Fund", "UNICEF", "UN system");
    const undp = await org("undp", "United Nations Development Programme", "UNDP", "UN system");
    const iom = await org("iom", "International Organization for Migration", "IOM", "UN system");
    const unv = await org("unv", "UN Volunteers", "UNV", "UN system");
    const wfp = await org("wfp", "World Food Programme", "WFP", "UN system");
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

    type Row = { title: string; org?: number | null; cc?: string | null; loc?: string | null; cat?: string; grade?: string | null; type?: string | null; remote?: boolean | null; summary?: string | null };
    const rows: Row[] = [
      { title: "EULEX Kosovo 3-2026 Call for Contributions" },
      { title: "Thailand Project Director, AFGHS-FHI 360" },
      { title: "Logistics Officer P3 – Global Supply Chain Budget Management", org: wfp, cc: "IT", loc: "Rome, Italy", cat: "procurement-logistics" },
      { title: "Logistics Officer – P3 (Global Commodity Tracking)", org: wfp, cc: "IT", loc: "Rome, Italy", cat: "procurement-logistics" },
      { title: "Programme Officer", org: undp, cc: "CH", loc: "Geneva, Switzerland", cat: "programme-management", grade: "P-3" },
      { title: "National Post, Programme Finance Associate [G6], Tonga", org: undp, cc: "TO", loc: "Nuku'alofa, Tonga", cat: "finance" },
      { title: "Chargé(e) d'Analyse sociale – SSA NOB basée en Ituri", org: who, cc: "CD", loc: "Bunia", cat: "other" },
      { title: "Community Outreach Assistant", org: unv, cc: "KE", loc: "Nairobi, Kenya", cat: "communications" },
      { title: "Field Volunteer", org: undp, cc: "KE", loc: "Nairobi, Kenya", cat: "other", type: "Volunteer" },
      { title: "Civil Engineer", org: undp, cc: "KE", loc: "Nairobi, Kenya", cat: "engineering-infrastructure" },
      { title: "Senior Engineer, Water", org: unicef, cc: "UG", loc: "Kampala, Uganda", cat: "engineering-infrastructure" },
      { title: "Monitoring & Evaluation Officer, NO-1", org: unicef, cc: "BA", loc: "Sarajevo", cat: "monitoring-evaluation" },
      { title: "M&E Specialist", org: iom, cc: "KE", loc: "Nairobi, Kenya", cat: "other" },
      { title: "E T Consultant – Analyst", org: undp, cc: "US", loc: "New York, United States", cat: "other", summary: "The consultant will support the M and E team." },
      { title: "Systems Development Specialist", org: undp, loc: "Home Based", cat: "it", remote: null },
      { title: "Programme Policy Officer – Identity Management, CST II", org: wfp, cc: "SS", loc: "Juba; also Sudan, Republic of South", cat: "programme-management" },
      { title: "Supply Chain Officer – Planning", org: wfp, cc: "CD", loc: "Kinshasa; also Congo, The Dem. Rep.Of", cat: "procurement-logistics" },
      { title: "Humanitarian Coordinator", org: undp, cc: "SD", loc: "Khartoum, Sudan", cat: "programme-management" },
      { title: "Health Officer", org: who, cc: "CG", loc: "Brazzaville, Congo", cat: "health" },
      { title: "Senior Information Management and GIS Associate – DTM", org: iom, cc: "PG", loc: "Port Moresby", cat: "data-analytics" },
      { title: "Senior Information Management and GIS Associate – DTM", org: iom, cc: "PG", loc: "Port Moresby", cat: "data-analytics" },
      { title: "Technical Officer", org: who, cc: "CH", loc: "Geneva, Switzerland", cat: "health" },
      { title: "Partnerships Specialist, NO-3 (Open for the nationals of Madagascar only)", org: unicef, cc: "MG", loc: "Antananarivo, Madagascar", cat: "other", summary: "For candidates who have experience; it is expected that the specialist leads partnerships." },
      { title: "IT Operations Associate", org: undp, cc: "DK", loc: "Copenhagen, Denmark", cat: "it" },
      { title: "Driver", org: iom, cc: "KE", loc: "Nairobi, Kenya", cat: "administration", summary: "Drives the vehicle and keeps it clean. Reports to the officer who supervises the fleet." },
      { title: "Finance Officer", org: undp, cc: "KE", loc: "Nairobi, Kenya", cat: "finance" },
      { title: "(Senior) Investment Officer – Corporate Finance Services", org: undp, cc: "LU", loc: "Luxembourg", cat: "finance" },
      { title: "Officer, Finance and Budget", org: who, cc: "CH", loc: "Geneva, Switzerland", cat: "finance" },
      { title: "Monitoring Assistant, SC5", org: wfp, cc: "KE", loc: "Nairobi, Kenya", cat: "monitoring-evaluation" },
      { title: "Consultant National en transformation numérique", org: undp, cc: "SN", loc: "Dakar, Sénégal", cat: "it" },
      { title: "Response Officer, Juba, South Sudan", org: wfp, cc: "SS", loc: "Juba", cat: "programme-management" },
    ];
    for (const [i, r] of rows.entries()) {
      await sql`
        insert into jobs (slug, title, organization_id, country_code, location_text, category, grade, job_type, is_remote, summary, apply_url, apply_host, url_hash, deadline, status, first_seen_at)
        values (${`audit-${i}`}, ${r.title}, ${r.org ?? null}, ${r.cc ?? null}, ${r.loc ?? null}, ${r.cat ?? "other"}, ${r.grade ?? null}, ${r.type ?? null}, ${r.remote ?? null}, ${r.summary ?? null},
                ${`https://example.org/a${i}`}, 'example.org', ${`audit-hash-${i}`}, ${future}, 'active', now() - make_interval(mins => ${rows.length - i}))`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  const search = (f: Parameters<typeof jobs.searchJobs>[0]) => jobs.searchJobs(f, 50, { looseFallback: true });
  const titles = async (f: Parameters<typeof jobs.searchJobs>[0]) => (await search(f)).items.map((j) => j.title);
  const q = (text: string) => titles({ q: text });

  it("a country word in the keyword also finds vacancies that only name the country in the title", async () => {
    expect(await q("kosovo")).toEqual(["EULEX Kosovo 3-2026 Call for Contributions"]);
    expect(await q("thailand")).toContain("Thailand Project Director, AFGHS-FHI 360");
  });

  it("a grade word in the keyword also finds titles that carry the grade, however it is written", async () => {
    expect((await q("logistics P3")).sort()).toEqual(["Logistics Officer P3 – Global Supply Chain Budget Management", "Logistics Officer – P3 (Global Commodity Tracking)"].sort());
    expect(await q("P3")).toEqual(expect.arrayContaining(["Programme Officer", "Logistics Officer P3 – Global Supply Chain Budget Management", "Logistics Officer – P3 (Global Commodity Tracking)"]));
    expect(await q("p-3")).toHaveLength(3);
    expect(await q("G6")).toContain("National Post, Programme Finance Associate [G6], Tonga");
    expect(await q("NOB")).toContain("Chargé(e) d'Analyse sociale – SSA NOB basée en Ituri");
  });

  it("a contract word in the keyword keeps vacancies of an organization with that word in its name", async () => {
    expect((await q("volunteer")).sort()).toEqual(["Community Outreach Assistant", "Field Volunteer"]);
  });

  it("a plural finds what the singular finds", async () => {
    expect((await q("engineers")).sort()).toEqual((await q("engineer")).sort());
    expect(await q("engineers")).toHaveLength(2);
    expect((await q("officers")).sort()).toEqual((await q("officer")).sort());
  });

  it("M&E, however it is typed, finds monitoring and evaluation vacancies and nothing else", async () => {
    const expected = ["M&E Specialist", "Monitoring & Evaluation Officer, NO-1", "Monitoring Assistant, SC5"];
    for (const text of ["M&E", "m & e", "M and E"]) expect((await q(text)).sort(), text).toEqual(expected);
  });

  it("remote only includes a vacancy whose location says Home Based", async () => {
    expect(await titles({ remote: true })).toEqual(["Systems Development Specialist"]);
    expect(await countFor({ remote: true })).toBe(1);
  });

  it("a country written the other way round is not read as its shorter neighbour", async () => {
    expect(await titles({ country: ["sudan"] })).toEqual(["Humanitarian Coordinator"]);
    expect((await titles({ country: ["south-sudan"] })).sort()).toEqual(["Programme Policy Officer – Identity Management, CST II", "Response Officer, Juba, South Sudan"]);
    expect(await titles({ country: ["republic-of-the-congo"] })).toEqual(["Health Officer"]);
    expect((await titles({ country: ["democratic-republic-of-the-congo"] })).sort()).toEqual(["Chargé(e) d'Analyse sociale – SSA NOB basée en Ituri", "Supply Chain Officer – Planning"]);
  });

  it("a vacancy posted twice is listed and counted once, everywhere", async () => {
    const res = await search({ org: ["iom"] });
    expect(res.items.filter((j) => j.title.startsWith("Senior Information Management"))).toHaveLength(1);
    expect(res.total).toBe(res.items.length);
    expect(await countFor({ org: ["iom"] })).toBe(res.total);
    const all = await search({});
    expect(all.total).toBe(all.items.length);
    expect(all.total).toBe(30);
  });

  it("short words match titles, places and organizations, not running text", async () => {
    expect((await q("WHO")).sort()).toEqual(["Chargé(e) d'Analyse sociale – SSA NOB basée en Ituri", "Health Officer", "Officer, Finance and Budget", "Technical Officer"]);
    expect((await q("IT")).sort()).toEqual(["Consultant National en transformation numérique", "IT Operations Associate", "Systems Development Specialist"]);
  });

  it("an exact title comes first, and a quoted phrase must be in that order", async () => {
    expect((await q("finance officer"))[0]).toBe("Finance Officer");
    expect(await q('"officer finance"')).toEqual(["Officer, Finance and Budget"]);
    expect(await q('"finance officer"')).toEqual(["Finance Officer"]);
  });

  it("hide local-only posts removes the local posts the audit named; the National Officer filter finds NO-1 to NO-5", async () => {
    const shown = await titles({ hidelocal: true });
    for (const t of [
      "Partnerships Specialist, NO-3 (Open for the nationals of Madagascar only)", "Monitoring & Evaluation Officer, NO-1", "National Post, Programme Finance Associate [G6], Tonga",
      "Monitoring Assistant, SC5", "Consultant National en transformation numérique", "Chargé(e) d'Analyse sociale – SSA NOB basée en Ituri",
    ]) expect(shown, t).not.toContain(t);
    expect(shown).toContain("Programme Officer");
    expect(await titles({ grade: ["NO"] })).toEqual(expect.arrayContaining(["Monitoring & Evaluation Officer, NO-1", "Partnerships Specialist, NO-3 (Open for the nationals of Madagascar only)"]));
  });

  it("filter values in an address work in any letter case, and every ticked box counts", () => {
    expect(jobs.parseFilters({ where: "Kenya", org: "IOM", grade: "p-3", type: "consultancy", lang: "french", remote: "yes" }))
      .toEqual({ country: ["kenya"], org: ["iom"], grade: ["P-3"], type: ["Consultancy"], lang: ["French"], remote: true });
    const allCategories = ["data-analytics", "it", "monitoring-evaluation", "human-resources", "finance", "procurement-logistics", "legal-compliance", "food-security-agriculture", "health", "wash", "education", "security"];
    expect(jobs.parseFilters({ category: allCategories }).category).toHaveLength(12);
  });

  it("the looser matching doesn't over-match (re-check findings A to C)", async () => {
    // "intern" is a whole word: not every vacancy at an "International …" organization.
    expect(await q("intern")).toEqual([]);
    // A plural never matches a longer word that starts with its singular ("units" is not "United").
    // (Only the labelled "similar words" fallback, shown when nothing matches, may look wider.)
    expect((await jobs.searchJobs({ q: "units" }, 50)).items).toEqual([]);
    // A country word never matches a title that names a longer country containing it.
    expect(await q("sudan")).toEqual(["Humanitarian Coordinator"]);
  });

  it("language and experience take several choices (any of them)", () => {
    expect(jobs.parseFilters({ lang: ["Spanish", "french", "Klingon"], exp: ["6-9", "3-5", "99"] })).toEqual({ lang: ["French", "Spanish"], exp: ["3-5", "6-9"] });
    expect(jobs.jobsUrl({ lang: ["French", "Spanish"], exp: ["3-5", "6-9"] })).toBe("/jobs?lang=French&lang=Spanish&exp=3-5&exp=6-9");
  });

  it("nonsense input matches nothing instead of dozens of vacancies", async () => {
    expect((await search({ q: "🚀" })).total).toBe(30);
    expect(await q("🚀 engineer")).toHaveLength(2);
  });
});
