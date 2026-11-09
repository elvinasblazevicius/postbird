/**
 * Accent-insensitive search, organization aliases and the local-only rule from titles, against a
 * THROWAWAY database (TEST_DATABASE_URL; tables are emptied). Skipped without one.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("search text and local-only titles (database)", () => {
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

    const org = async (slug: string, name: string, short: string | null, type: string | null) =>
      (await sql`insert into organizations (slug, name, short_name, org_type) values (${slug}, ${name}, ${short}, ${type}) returning id`)[0].id;
    const msf = await org("msf", "Médecins Sans Frontières", "MSF", "NGO");
    const idb = await org("inter-american-development-bank", "Inter-American Development Bank", null, "International financial institution");
    const unicef = await org("unicef", "UNICEF", "UNICEF", "UN system");
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const rows: [string, number, string, string | null, string | null][] = [
      // title, org, country, grade, summary
      ["Coordinador de Educación", unicef, "CO", null, null],
      ["Médico de Urgencias", msf, "HT", null, "Atención médica en Côte d'Ivoire y Haití."],
      ["Nurse Supervisor", msf, "HT", null, null],
      ["Transport Economist", idb, "US", null, null],
      ["National Professional Officer - Health", unicef, "CO", null, null],
      ["Senior Driver (G)", unicef, "CO", null, null],
      ["Health Specialist", unicef, "CO", "P-4", null],
    ];
    for (const [i, [title, o, cc, grade, summary]] of rows.entries()) {
      await sql`
        insert into jobs (slug, title, organization_id, country_code, grade, summary, apply_url, apply_host, url_hash, deadline, status)
        values (${`t-${i}`}, ${title}, ${o}, ${cc}, ${grade}, ${summary}, ${`https://example.org/t/${i}`}, 'example.org', ${`t-hash-${i}`}, ${future}, 'active')`;
    }
  });

  afterAll(async () => {
    await sql?.end();
  });

  const titles = async (f: Parameters<typeof jobs.searchJobs>[0]) => (await jobs.searchJobs(f, 50, { looseFallback: true })).items.map((j) => j.title).sort();

  it("matches words without their accents, both ways", async () => {
    expect(await titles({ q: "educacion" })).toEqual(["Coordinador de Educación"]);
    expect(await titles({ q: "educación" })).toEqual(["Coordinador de Educación"]);
    expect(await titles({ q: "medico" })).toEqual(["Médico de Urgencias"]);
    // In the indexed summary too.
    expect(await titles({ q: "atencion" })).toEqual(["Médico de Urgencias"]);
    // Organization names.
    expect(await titles({ q: "medecins nurse" })).toEqual(["Nurse Supervisor"]);
  });

  it("finds an organization by its acronym or another name", async () => {
    expect(await titles({ q: "msf" })).toEqual(["Médico de Urgencias", "Nurse Supervisor"]);
    expect(await titles({ q: "doctors without borders" })).toEqual(["Médico de Urgencias", "Nurse Supervisor"]);
    // Stored without a short name: the alias still finds it.
    expect(await titles({ q: "idb economist" })).toEqual(["Transport Economist"]);
  });

  it("hides posts that are local-only by title, and counts NPO titles as grade NO", async () => {
    expect(await titles({ country: ["colombia"], hidelocal: true })).toEqual(["Coordinador de Educación", "Health Specialist"]);
    expect(await titles({ grade: ["NO"] })).toEqual(["National Professional Officer - Health"]);
  });

  it("counts jobs by employer type for the landing pages", async () => {
    expect(await countFor({ orgtype: "ngo" })).toBe(2);
    expect(await countFor({ orgtype: "ifi" })).toBe(1);
    expect(await countFor({ orgtype: "eu" })).toBe(0);
    expect((await jobs.openJobsByIds([1, 2, 999999])).map((j) => j.id).sort()).toEqual([1, 2]);
  });
});
