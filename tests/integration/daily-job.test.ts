/**
 * The daily job's tasks run on their own, against a real database: one subscriber's failed search
 * doesn't stop the others' paid alert or weekly email (that subscriber stays due), and when the
 * weekly email fails outright the plan emails and the alerts still go out, the failure is recorded
 * on Admin → Overview and the run counts as failed (no heartbeat, HTTP 500).
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables are emptied). Resend is
 * replaced by a stub, and the job search throws for any search for "explode".
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...real,
    searchJobs: async (...args: Parameters<typeof real.searchJobs>) => {
      if (String(args[0]?.q ?? "").includes("explode")) throw new Error("search failed (test)");
      return real.searchJobs(...args);
    },
  };
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("daily job: tasks and subscribers fail on their own (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let digest: typeof import("@/lib/digest");
  let heartbeat: typeof import("@/lib/heartbeat");
  const sent: { to: string; subject: string }[] = [];
  let seq = 0;

  async function addJob(title: string) {
    const slug = `daily-${++seq}`;
    await sql`
      insert into jobs (slug, title, apply_url, apply_host, url_hash, status, first_seen_at, published_at)
      values (${slug}, ${title}, ${`https://example.org/${slug}`}, 'example.org', ${`hash-${slug}`}, 'active', now() - interval '2 hours', now() - interval '2 hours')`;
  }

  /** A confirmed subscriber with one saved search: a paid plan (alerts) or none (the free weekly email). */
  async function sub(email: string, search: string, billing: "active" | "none"): Promise<number> {
    const [{ id }] = await sql`
      insert into subscribers (email, status, confirmed_at, wants_alerts, weekly_email, billing_status, plan, frequency, unsubscribe_token)
      values (${email}, 'confirmed', now() - interval '30 days', true, ${billing === "none"}, ${billing}, ${billing === "none" ? "free" : "premium"}, 'daily',
              ${`unsub-${email.replace(/\W/g, "-")}`.padEnd(24, "x")})
      returning id::int as id`;
    await sql`insert into saved_searches (subscriber_id, search, label) values (${id}, ${search}, ${search || "All new vacancies"})`;
    return id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    delete process.env.PADDLE_API_KEY; // the billing checks then report "skipped", which isn't a failure

    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://api.resend.com/")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], subject: m.subject });
        return Response.json({ id: "stub" });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });

    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    digest = await import("@/lib/digest");
    heartbeat = await import("@/lib/heartbeat");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    await sql.unsafe(`truncate subscribers, saved_searches, paddle_checkouts, events, digests, jobs, job_sources, organizations,
      rate_limits, billing_flags, alert_closing_sent, ops_events restart identity cascade`);
    await sql`update locks set locked_until = null, holder = null`;
    await addJob("Nurse coordinator");
  });

  it("paid alerts: one subscriber's search fails, the others are still sent; that one stays due", async () => {
    const ok = await sub("alert-ok@example.org", "q=nurse", "active");
    const bad = await sub("alert-bad@example.org", "q=explode", "active");
    const all = await sub("alert-all@example.org", "", "active");

    const res = await digest.runAlerts();
    expect(res).toMatchObject({ status: "sent", due: 3, sent: 2, failed: 1 });
    expect(res.message).toContain("Search lookup failed: search failed (test)");
    expect(sent.map((m) => m.to).sort()).toEqual(["alert-all@example.org", "alert-ok@example.org"]);
    const last = async (id: number) => (await sql`select last_sent_at from saved_searches where subscriber_id = ${id}`)[0].last_sent_at;
    expect(await last(ok)).not.toBeNull();
    expect(await last(all)).not.toBeNull();
    expect(await last(bad)).toBeNull();

    // Once the search works again, the next run sends it (the others aren't due yet).
    sent.length = 0;
    await sql`update saved_searches set search = 'q=nurse' where subscriber_id = ${bad}`;
    await sql`update locks set locked_until = null, holder = null`;
    expect(await digest.runAlerts()).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["alert-bad@example.org"]);
  });

  it("the free weekly email: one subscriber's search fails, the others are sent; the week stays open for a retry", async () => {
    await sub("weekly-ok@example.org", "q=nurse", "none");
    const bad = await sub("weekly-bad@example.org", "q=explode", "none");
    const [{ now }] = await sql`select now() as now`;
    const monday = new Date(digest.weekStart(new Date(now)).getTime() + (6 * 60 + 23) * 60_000);

    const res = await digest.runDigest({ at: monday });
    expect(res).toMatchObject({ status: "sent", sent: 1, failed: 1 });
    expect(sent.map((m) => m.to)).toEqual(["weekly-ok@example.org"]);
    expect((await sql`select last_digest_at from subscribers where id = ${bad}`)[0].last_digest_at).toBeNull();
    expect((await sql`select status from digests where period_key = ${res.periodKey}`)[0].status).toBe("failed");
  });

  it("when the weekly email fails outright, the plan emails and the alerts still run, and the run counts as failed", async () => {
    // A confirmed trial ending in 2 days: its trial reminder is a plan email.
    await sql`
      insert into subscribers (email, status, confirmed_at, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, welcome_sent_at, unsubscribe_token)
      values ('trial-ending@example.org', 'confirmed', now() - interval '12 days', 'trialing', 'premium', 'month', 'sub_01hv8x29kz0t586xy6zn1a7d01',
              now() + interval '2 days', now() - interval '12 days', ${"unsub-trial-ending".padEnd(24, "x")})`;
    await sub("alert-ok@example.org", "q=nurse", "active");
    await sql`delete from settings where key = ${heartbeat.DAILY_JOB_KEY}`;

    // The weekly email can't even read its record: it throws.
    await sql`alter table digests rename to digests_hidden`;
    let res: Awaited<ReturnType<typeof digest.runDailyJob>>;
    try {
      res = await digest.runDailyJob();
    } finally {
      await sql`alter table digests_hidden rename to digests`;
    }
    expect(res.digest).toMatchObject({ failed: expect.stringContaining("digests") });
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatch(/^Weekly email failed: /);
    expect(res.billing).toMatchObject({ skipped: expect.any(String) });
    expect(res.planEmails).toMatchObject({ trialReminders: { sent: 1, failed: 0 } });
    expect(res.alerts).toMatchObject({ status: "sent", sent: 1 });
    expect(sent.map((m) => m.to).sort()).toEqual(["alert-ok@example.org", "trial-ending@example.org"]);
    // Shown on Admin → Overview, and not counted as the day's run.
    const events = await sql`select source, message from ops_events where resolved_at is null`;
    expect(events).toEqual([{ source: "emails", message: expect.stringMatching(/^Weekly email failed: .*digests/) }]);
    expect((await heartbeat.readDailyJob()).at).toBeNull();

    // The same run through /api/cron/digest answers 500, with each task's result.
    await sql`alter table digests rename to digests_hidden`;
    process.env.CRON_SECRET = "test-cron-secret-0123456789abcdef";
    try {
      const { GET } = await import("@/app/api/cron/digest/route");
      const r = await GET(new Request("http://localhost/api/cron/digest", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      expect(r.status).toBe(500);
      const body = await r.json();
      expect(body.failed).toEqual([expect.stringMatching(/^Weekly email failed: /)]);
      expect(body.alerts).toMatchObject({ status: "sent" });
      expect(body.planEmails).toMatchObject({ trialReminders: expect.any(Object) });
    } finally {
      delete process.env.CRON_SECRET;
      await sql`alter table digests_hidden rename to digests`;
    }

    // A good run stores the heartbeat.
    await sql`update locks set locked_until = null, holder = null`;
    expect((await digest.runDailyJob()).failed).toEqual([]);
    expect((await heartbeat.readDailyJob()).at).not.toBeNull();
  });
});
