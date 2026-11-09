/**
 * The free weekly email against a real database: sign-up and confirmation
 * store the one saved search, the Monday send lists only that search's new
 * matches, nothing goes out without matches, subscribers with a plan never get
 * it, and free subscribers keep one saved search.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables
 * are emptied). Email sending (Resend) is replaced by a stub.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Sent = { to: string; subject: string; text: string; html: string; headers?: Record<string, string>; key?: string };

describe.skipIf(!TEST_DB)("free weekly email (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let digest: typeof import("@/lib/digest");
  let subscribers: typeof import("@/lib/subscribers");
  let saved: typeof import("@/lib/saved-searches");
  let email: typeof import("@/lib/email");
  const sent: Sent[] = [];
  let seq = 0;

  // This week's Monday, 06:23 UTC (the scheduled run), and the Tuesday after it.
  let monday: Date;
  let tuesday: Date;

  async function addJob(title: string, firstSeenHoursAgo: number, extra: { demo?: boolean; deadline?: string | null; org?: string } = {}) {
    const slug = `${title.toLowerCase().replace(/\W+/g, "-")}-${++seq}`;
    await sql`
      insert into jobs (slug, title, organization_id, apply_url, apply_host, url_hash, status, is_demo, deadline, first_seen_at, published_at)
      values (${slug}, ${title}, (select id from organizations where slug = ${extra.org ?? "weekly-agency"}), ${`https://example.org/${slug}`}, 'example.org',
              ${`hash-${slug}`}, 'active', ${extra.demo ?? false}, ${extra.deadline === undefined ? null : extra.deadline},
              now() - make_interval(hours => ${firstSeenHoursAgo}), now() - make_interval(hours => ${firstSeenHoursAgo}))`;
  }

  /** A confirmed free subscriber of the weekly email, with an optional saved search. */
  async function freeSub(addr: string, search: string | null, billing = "none"): Promise<number> {
    const [{ id }] = await sql`
      insert into subscribers (email, status, wants_alerts, weekly_email, billing_status, unsubscribe_token, confirmed_at)
      values (${addr}, 'confirmed', true, true, ${billing}, ${`unsub-${addr}`}, now()) returning id::int as id`;
    if (search !== null) await sql`insert into saved_searches (subscriber_id, search, label) values (${id}, ${search}, ${search || "All new vacancies"})`;
    return id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    // Billing live, so the weekly email offers the free trial.
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = "test_client_token";
    process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY = "pri_monthly_unused";
    process.env.NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY = "pri_quarterly_unused";

    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://api.resend.com/")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
        for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], subject: m.subject, text: m.text, html: m.html, headers: m.headers, key });
        return new Response(JSON.stringify({ id: "stub" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });

    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    }
    await sql.unsafe(`truncate subscribers, saved_searches, paddle_checkouts, paddle_events, events, digests,
      jobs, job_sources, organizations, rate_limits restart identity cascade`);
    await sql`insert into organizations (slug, name, logo_checked_at) values ('weekly-agency', 'Weekly Agency', now()), ('other-agency', 'Other Agency', now())`;
    digest = await import("@/lib/digest");
    subscribers = await import("@/lib/subscribers");
    saved = await import("@/lib/saved-searches");
    email = await import("@/lib/email");

    const [{ now }] = await sql`select now() as now`;
    monday = new Date(digest.weekStart(new Date(now)).getTime() + (6 * 60 + 23) * 60_000);
    tuesday = new Date(monday.getTime() + 86_400_000);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    await sql`update locks set locked_until = null, holder = null`;
    await sql`truncate digests restart identity`;
    await sql`truncate subscribers, saved_searches, paddle_checkouts, rate_limits restart identity cascade`;
    await sql`delete from jobs`;
  });

  describe("sign-up and saved search", () => {
    it("stores nothing until the address is confirmed, then keeps the chosen search as the one saved search", async () => {
      const res = await subscribers.signup({ email: "Free.Person@Example.org", kind: "alerts", weeklySearch: "q=nurse&org=weekly-agency", preferences: { search: "q=nurse&org=weekly-agency" } });
      expect(res).toEqual({ ok: true, state: "check_email" });
      expect(sent).toHaveLength(1);
      expect(sent[0].text).toContain("free weekly email");
      const [pending] = await sql`select id::int as id, status, weekly_email, confirm_token from subscribers where email = 'free.person@example.org'`;
      expect(pending).toMatchObject({ status: "pending", weekly_email: false });
      expect(await sql`select 1 from saved_searches where subscriber_id = ${pending.id}`).toHaveLength(0);

      const confirmed = await subscribers.confirmSubscriber(pending.confirm_token);
      expect(confirmed).toMatchObject({ ok: true, weekly: true, paidPlan: false });
      const [after] = await sql`select status, weekly_email from subscribers where id = ${pending.id}`;
      expect(after).toMatchObject({ status: "confirmed", weekly_email: true });
      const searches = await sql`select search, label from saved_searches where subscriber_id = ${pending.id}`;
      expect(searches.map((r: { search: string }) => r.search)).toEqual(["q=nurse&org=weekly-agency"]);
      expect(searches[0].label).toBe("“nurse”, at Weekly Agency");
    });

    it("signing up again with another search replaces the free search once confirmed (still one)", async () => {
      const id = await freeSub("again@example.org", "q=nurse");
      await subscribers.signup({ email: "again@example.org", kind: "alerts", weeklySearch: "q=pilot" });
      // Nothing changes before the owner confirms.
      expect((await sql`select search from saved_searches where subscriber_id = ${id}`).map((r: { search: string }) => r.search)).toEqual(["q=nurse"]);
      const [{ confirm_token }] = await sql`select confirm_token from subscribers where id = ${id}`;
      await subscribers.confirmSubscriber(confirm_token);
      expect((await sql`select search from saved_searches where subscriber_id = ${id}`).map((r: { search: string }) => r.search)).toEqual(["q=pilot"]);
    });

    it("choosing nothing means the week's newest vacancies ('' saved)", async () => {
      await subscribers.signup({ email: "any@example.org", kind: "alerts", weeklySearch: "" });
      const [{ id, confirm_token }] = await sql`select id::int as id, confirm_token from subscribers where email = 'any@example.org'`;
      await subscribers.confirmSubscriber(confirm_token);
      expect((await sql`select search from saved_searches where subscriber_id = ${id}`).map((r: { search: string }) => r.search)).toEqual([""]);
    });

    it("an early-access sign-up does not switch the weekly email on", async () => {
      await subscribers.signup({ email: "early@example.org", kind: "waitlist", weeklySearch: "q=nurse" });
      const [{ id, confirm_token }] = await sql`select id::int as id, confirm_token from subscribers where email = 'early@example.org'`;
      const res = await subscribers.confirmSubscriber(confirm_token);
      expect(res).toMatchObject({ ok: true, weekly: false });
      expect((await sql`select weekly_email from subscribers where id = ${id}`)[0].weekly_email).toBe(false);
      expect(await sql`select 1 from saved_searches where subscriber_id = ${id}`).toHaveLength(0);
    });

    it("free subscribers are limited to one saved search; a plan allows five", async () => {
      const id = await freeSub("limit@example.org", "q=nurse");
      const second = await saved.addSavedSearch(id, "q=pilot");
      expect(second.ok).toBe(false);
      expect(!second.ok && second.error).toMatch(/free weekly email uses one search/);
      // The database refuses it too, whatever the code path.
      await expect(sql`insert into saved_searches (subscriber_id, search) values (${id}, 'q=driver')`).rejects.toMatchObject({ code: "P0001" });
      expect(await sql`select 1 from saved_searches where subscriber_id = ${id}`).toHaveLength(1);
      expect(saved.searchLimit("none")).toBe(1);
      expect(saved.searchLimit("canceled")).toBe(1);

      await sql`update subscribers set billing_status = 'trialing' where id = ${id}`;
      for (const q of ["q=pilot", "q=driver", "q=cook", "q=guard"]) expect((await saved.addSavedSearch(id, q)).ok).toBe(true);
      const sixth = await saved.addSavedSearch(id, "q=clerk");
      expect(!sixth.ok && sixth.error).toMatch(/up to 5 searches/);
    });
  });

  describe("Monday send", () => {
    it("a free subscriber with a saved search gets only the past week's new, open matches", async () => {
      const id = await freeSub("nurse@example.org", "q=nurse");
      await addJob("Nurse coordinator", 2);
      await addJob("Senior nurse", 24 * 5);
      await addJob("Nurse trainer (demo)", 1, { demo: true });
      await addJob("Nurse closed", 1, { deadline: "2020-01-01" });
      await addJob("Accountant", 1);
      await addJob("Nurse old", 24 * 9);

      const res = await digest.runDigest({ at: monday });
      expect(res).toMatchObject({ status: "sent", recipients: 1, sent: 1, failed: 0, empty: 0 });
      expect(sent).toHaveLength(1);
      const m = sent[0];
      expect(m.to).toBe("nurse@example.org");
      expect(m.subject).toBe("2 new vacancies match your search this week");
      expect(m.text).toContain("Nurse coordinator");
      expect(m.text).toContain("Senior nurse");
      expect(m.text).not.toMatch(/demo|Nurse closed|Accountant|Nurse old/);
      // One calm line about daily alerts, with the search filled in, and the usual links.
      expect(m.text).toContain("Want new matches every day, with up to 5 searches? Start a 14-day free trial: http://localhost:3000/pricing/trial?search=q%3Dnurse&");
      expect(m.text).toContain("/account?t=");
      expect(m.headers?.["List-Unsubscribe"]).toContain("/api/unsubscribe?token=");
      // The idempotency key is built from the recipient's id for this week.
      const week = digest.isoWeekKey(monday);
      expect(m.key).toBe(email.batchKey(`digest:${week}`, [`digest:${week}:${id}`]));

      const [row] = await sql`select last_digest_at from subscribers where id = ${id}`;
      const [d] = await sql`select status, started_at from digests where period_key = ${week}`;
      expect(d.status).toBe("done");
      expect(new Date(row.last_digest_at).getTime()).toBe(new Date(d.started_at).getTime());
      expect((await sql`select last_sent_at from saved_searches where subscriber_id = ${id}`)[0].last_sent_at).not.toBeNull();
    });

    it("lists at most 10 with a See all link and the total in the subject", async () => {
      await freeSub("many@example.org", "q=nurse");
      for (let i = 0; i < 14; i++) await addJob(`Nurse number ${i}`, i + 1);
      await digest.runDigest({ at: monday });
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe("14 new vacancies match your search this week");
      expect((sent[0].text.match(/^Nurse number/gm) ?? []).length).toBe(10);
      expect(sent[0].text).toMatch(/See all 14: http:\/\/localhost:3000\/jobs\?q=nurse&posted=7&utm_source=digest/);
    });

    it("sends nothing when there are no new matches that week", async () => {
      const id = await freeSub("quiet@example.org", "q=astronaut");
      await addJob("Nurse coordinator", 2);
      const res = await digest.runDigest({ at: monday });
      expect(res).toMatchObject({ sent: 0, empty: 1, recipients: 0 });
      expect(sent).toHaveLength(0);
      expect((await sql`select last_digest_at from subscribers where id = ${id}`)[0].last_digest_at).toBeNull();
    });

    it("without a saved search, the subscriber gets the week's newest vacancies", async () => {
      await freeSub("everything@example.org", null);
      await addJob("Nurse coordinator", 2);
      await addJob("Accountant", 3);
      await digest.runDigest({ at: monday });
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe("2 new international vacancies this week");
      expect(sent[0].text).toContain("Accountant");
    });

    it("subscribers with a plan never get the weekly email, even if they once signed up for it", async () => {
      for (const b of ["trialing", "active", "past_due", "paused"]) await freeSub(`paid-${b}@example.org`, "q=nurse", b);
      await freeSub("free@example.org", "q=nurse");
      await freeSub("gone@example.org", "q=nurse", "canceled"); // plan ended, had signed up for the weekly email
      await sql`insert into subscribers (email, status, wants_alerts, billing_status, unsubscribe_token) values ('paid-only@example.org', 'confirmed', true, 'none', 'unsub-paid-only')`;
      await addJob("Nurse coordinator", 2);
      await digest.runDigest({ at: monday });
      expect(sent.map((m) => m.to).sort()).toEqual(["free@example.org", "gone@example.org"]);
    });

    it("goes out on Mondays only, once a week per subscriber; later runs only retry, never resend", async () => {
      await freeSub("weekly@example.org", "q=nurse");
      await addJob("Nurse coordinator", 2);
      const tue = await digest.runDigest({ at: tuesday });
      expect(tue.status).toBe("skipped");
      expect(tue.message).toMatch(/Mondays/);
      expect(sent).toHaveLength(0);

      expect((await digest.runDigest({ at: monday })).sent).toBe(1);
      await addJob("Nurse adviser", 0);
      const again = await digest.runDigest({ at: tuesday });
      expect(again.message).toMatch(/already sent/);
      // The admin's "send now" skips the day rule but never sends a second email in the same week.
      const forced = await digest.runDigest({ at: tuesday, force: true });
      expect(forced.sent).toBe(0);
      expect(sent).toHaveLength(1);
    });

    it("a Monday run that failed is retried later in the week with the same window and key", async () => {
      await freeSub("retry@example.org", "q=nurse");
      await addJob("Nurse coordinator", 2);
      // Monday: Resend is down.
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ name: "internal_server_error", message: "down" }), { status: 500 }));
      const failed = await digest.runDigest({ at: monday });
      expect(failed).toMatchObject({ status: "failed", sent: 0, failed: 1 });
      vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "null"));
        const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
        for (const m of body) sent.push({ to: m.to[0], subject: m.subject, text: m.text, html: m.html, headers: m.headers, key });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });
      // A vacancy first seen after Monday's cut-off waits for next week.
      await addJob("Nurse adviser", 0);
      const retry = await digest.runDigest({ at: tuesday });
      expect(retry).toMatchObject({ status: "sent", sent: 1 });
      expect(sent[0].text).toContain("Nurse coordinator");
      expect(sent[0].text).not.toContain("Nurse adviser");
    });
  });

  describe("retention", () => {
    it("keeps an ended plan's address while it still gets the free weekly email", async () => {
      const kept = await freeSub("kept@example.org", "q=nurse", "canceled");
      await sql`update subscribers set canceled_at = now() - interval '40 days' where id = ${kept}`;
      const gone = (await sql`
        insert into subscribers (email, status, billing_status, canceled_at, unsubscribe_token)
        values ('ended@example.org', 'confirmed', 'canceled', now() - interval '40 days', 'unsub-ended') returning id::int as id`)[0].id;
      await subscribers.purgeStaleSubscribers();
      expect(await sql`select 1 from subscribers where id = ${kept}`).toHaveLength(1);
      expect(await sql`select 1 from subscribers where id = ${gone}`).toHaveLength(0);
    });
  });
});
