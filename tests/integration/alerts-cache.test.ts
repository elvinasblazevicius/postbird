/**
 * Paid alerts look each search up once per run: subscribers who share a
 * search and its window share one database search, and at most 4 searches
 * run at once. Runs only with TEST_DATABASE_URL pointing at a THROWAWAY
 * database (tables are emptied). Email sending (Resend) is replaced by a stub.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ total: 0, running: 0, peak: 0, keys: [] as string[] }));
vi.mock("@/lib/jobs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...real,
    searchJobs: async (...args: Parameters<typeof real.searchJobs>) => {
      calls.total++;
      calls.running++;
      calls.peak = Math.max(calls.peak, calls.running);
      calls.keys.push(`${args[0].q ?? ""}|${args[0].firstSeenAfter?.toISOString()}`);
      try {
        // A little slower than real, so overlapping searches show in the peak.
        await new Promise((r) => setTimeout(r, 20));
        return await real.searchJobs(...args);
      } finally {
        calls.running--;
      }
    },
  };
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("paid alerts: one lookup per search and window (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  const sent: { to: string; text: string }[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch in test: ${url}`);
      const body = JSON.parse(String(init?.body ?? "null"));
      for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], text: m.text });
      return Response.json(Array.isArray(body) ? { data: body.map(() => ({ id: "stub" })) } : { id: "stub" });
    });
    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql.unsafe(`truncate subscribers, saved_searches, jobs, job_sources, organizations, digests restart identity cascade`);
    await sql`update locks set locked_until = null, holder = null`;

    await sql`insert into organizations (slug, name, logo_checked_at) values ('cache-agency', 'Cache Agency', now())`;
    const job = async (title: string) => {
      const slug = title.toLowerCase().replace(/\W+/g, "-");
      await sql`
        insert into jobs (slug, title, organization_id, apply_url, apply_host, url_hash, status, first_seen_at, published_at)
        values (${slug}, ${title}, (select id from organizations where slug = 'cache-agency'), ${`https://example.org/${slug}`}, 'example.org',
                ${`hash-${slug}`}, 'active', now() - interval '2 hours', now() - interval '2 hours')`;
    };
    for (const t of ["Nurse coordinator", "Pilot trainer", "Data analyst", "Water engineer", "Logistics officer", "Field nurse"]) await job(t);

    // 12 daily subscribers, none emailed yet: 6 searches between them, each shared by two.
    const searches = ["q=nurse", "q=pilot", "q=data", "q=water", "q=logistics", ""];
    for (let i = 0; i < 12; i++) {
      const [s] = await sql`
        insert into subscribers (email, status, confirmed_at, wants_alerts, frequency, billing_status, unsubscribe_token)
        values (${`cache-${i}@example.org`}, 'confirmed', now(), true, 'daily', 'active', ${`unsub-cache-${i}`.padEnd(24, "x")})
        returning id::int as id`;
      await sql`insert into saved_searches (subscriber_id, search, label) values (${s.id}, ${searches[i % 6]}, ${`Search ${i % 6}`})`;
    }
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  it("runs each shared search once, at most 4 at a time, and every subscriber still gets their matches", async () => {
    const { runAlerts } = await import("@/lib/digest");
    const res = await runAlerts();
    expect(res).toMatchObject({ status: "sent", due: 12, sent: 12, failed: 0 });
    expect(calls.total).toBe(6);
    expect(new Set(calls.keys).size).toBe(6);
    expect(calls.peak).toBeGreaterThan(1);
    expect(calls.peak).toBeLessThanOrEqual(4);
    // Two subscribers per search, each with that search's matches.
    expect(sent.filter((m) => m.text.includes("Nurse coordinator") && m.text.includes("Field nurse")).length).toBeGreaterThanOrEqual(2);
    expect(sent.filter((m) => m.text.includes("Pilot trainer"))).toHaveLength(4); // q=pilot twice, and "" (all new vacancies) twice
  });
});
