/**
 * Paid alerts against a real database: Paddle webhook → subscriber linking,
 * idempotency and ordering, and alert delivery without double sends.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables
 * are emptied). Email sending (Resend) is replaced by a stub.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// next/server's after() needs a Next.js request; here it runs the task at once
// and keeps its promise, so a test can wait for the emails a route sends.
const afterTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => { afterTasks.push(Promise.resolve().then(task)); },
}));
const settle = async () => { await Promise.all(afterTasks.splice(0)); };

const TEST_DB = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "pdl_ntfset_test_secret_0123456789";

const SUB_ID = "sub_01hv8x29kz0t586xy6zn1a62ny";
const SUB_ID_2 = "sub_01hv8x29kz0t586xy6zn1a62nz";
const CUSTOMER = "ctm_01hv6y1jedq4p1n0yqn5ba3ky4";

type Sent = { to: string; subject: string; text: string; headers?: Record<string, string>; replyTo?: string; key?: string };

describe.skipIf(!TEST_DB)("paid alerts (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let billing: typeof import("@/lib/billing/subscriptions");
  let digest: typeof import("@/lib/digest");
  let paddle: typeof import("@/lib/billing/paddle");
  let notices: typeof import("@/lib/billing/notices");
  let subscribers: typeof import("@/lib/subscribers");
  let account: typeof import("@/lib/account");
  const sent: Sent[] = [];
  let eventSeq = 0;

  /** A Paddle subscription event as the webhook delivers it. */
  function subEvent(type: string, over: Record<string, unknown> = {}, occurredAt = new Date().toISOString()) {
    return {
      event_id: `evt_test_${++eventSeq}`,
      event_type: type,
      occurred_at: occurredAt,
      notification_id: `ntf_test_${eventSeq}`,
      data: {
        id: SUB_ID,
        status: "trialing",
        customer_id: CUSTOMER,
        custom_data: null,
        billing_cycle: { interval: "month", frequency: 3 },
        current_billing_period: { starts_at: "2026-11-09T10:00:00Z", ends_at: "2026-11-23T10:00:00Z" },
        next_billed_at: "2026-11-23T10:00:00Z",
        canceled_at: null,
        scheduled_change: null,
        items: [{ price: { id: "pri_test" }, trial_dates: { starts_at: "2026-11-09T10:00:00Z", ends_at: "2026-11-23T10:00:00Z" } }],
        ...over,
      },
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PADDLE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    // Billing "live" (for the early-access email). The price ids match no test
    // subscription, so plans are still recognised by their billing cycle.
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = "test_client_token";
    process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY = "pri_monthly_unused";
    process.env.NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY = "pri_quarterly_unused";
    delete process.env.PADDLE_API_KEY;

    // Resend stub: records every message instead of sending it.
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://api.resend.com/")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
        for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], subject: m.subject, text: m.text, headers: m.headers, replyTo: m.reply_to, key });
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
    billing = await import("@/lib/billing/subscriptions");
    digest = await import("@/lib/digest");
    paddle = await import("@/lib/billing/paddle");
    notices = await import("@/lib/billing/notices");
    subscribers = await import("@/lib/subscribers");
    account = await import("@/lib/account");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    afterTasks.length = 0;
    await sql`update locks set locked_until = null, holder = null`;
  });

  describe("webhook → subscriber", () => {
    let ref = "";

    it("a checkout creates a pending subscriber with its first search, and sends no email", async () => {
      const res = await billing.startCheckout({
        email: "New.Person@Example.org", plan: "quarterly", search: "q=nurse", source: "test",
        attribution: { msclkid: "abc123", utm_medium: "cpc" }, visitor: "visitor-hash",
      });
      expect(res.ok && "ref" in res).toBe(true);
      ref = (res as { ref: string }).ref;
      const [s] = await sql`select status, billing_status, frequency, manage_token from subscribers where email = 'new.person@example.org'`;
      expect(s).toMatchObject({ status: "pending", billing_status: "none", frequency: "daily" });
      expect(s.manage_token).toMatch(/^[0-9a-f]{64}$/);
      expect((await sql`select search, label from saved_searches`).map((r: { search: string }) => r.search)).toEqual(["q=nurse"]);
      expect(sent).toHaveLength(0);
      // No account link before Paddle confirms the subscription.
      expect(await billing.checkoutAccountToken(ref)).toEqual({ linked: false, manageToken: null });
    });

    it("subscription.created links the subscription through customData and confirms the address", async () => {
      const res = await billing.handlePaddleEvent(subEvent("subscription.created", { custom_data: { ref } }));
      expect(res.outcome).toBe("applied");
      expect(res.welcome?.email).toBe("new.person@example.org");
      const [s] = await sql`
        select status, billing_status, plan, plan_interval, paddle_customer_id, paddle_subscription_id, trial_ends_at, welcome_sent_at, confirmed_at
        from subscribers where email = 'new.person@example.org'`;
      expect(s).toMatchObject({ status: "confirmed", billing_status: "trialing", plan: "premium", plan_interval: "quarter", paddle_customer_id: CUSTOMER, paddle_subscription_id: SUB_ID });
      expect(new Date(s.trial_ends_at).toISOString()).toBe("2026-11-23T10:00:00.000Z");
      expect(s.welcome_sent_at).not.toBeNull();
      expect(s.confirmed_at).not.toBeNull();
      const [ev] = await sql`select type, visitor, props from events where type = 'trial_started'`;
      expect(ev).toMatchObject({ visitor: "visitor-hash", props: { plan: "quarter", campaign: { msclkid: "abc123", utm_medium: "cpc" } } });
      // The browser that paid for this new account may now get its link.
      const token = await billing.checkoutAccountToken(ref);
      expect(token.linked).toBe(true);
      expect(token.manageToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it("ignores a repeated event and does not count the trial or send the welcome twice", async () => {
      const ev = subEvent("subscription.trialing", { custom_data: { ref } });
      expect((await billing.handlePaddleEvent(ev)).outcome).toBe("applied");
      const again = await billing.handlePaddleEvent(ev);
      expect(again.outcome).toBe("duplicate");
      expect(again.welcome).toBeUndefined();
      expect((await sql`select count(*)::int as n from events where type = 'trial_started'`)[0].n).toBe(1);
    });

    it("applies events in occurred_at order: a late, older event is ignored", async () => {
      const later = new Date(Date.now() + 60_000).toISOString();
      const earlier = new Date(Date.now() - 60_000).toISOString();
      await billing.handlePaddleEvent(subEvent("subscription.activated", {
        status: "active", custom_data: { ref }, items: [{ price: { id: "pri_test" } }],
        current_billing_period: { starts_at: "2026-11-23T10:00:00Z", ends_at: "2027-02-23T10:00:00Z" },
      }, later));
      expect((await billing.handlePaddleEvent(subEvent("subscription.updated", { custom_data: { ref } }, earlier))).outcome).toBe("stale");
      const [s] = await sql`select billing_status, current_period_end from subscribers where paddle_subscription_id = ${SUB_ID}`;
      expect(s.billing_status).toBe("active");
      expect(new Date(s.current_period_end).toISOString()).toBe("2027-02-23T10:00:00.000Z");
    });

    it("finds the subscriber by subscription id when customData is missing, and records a cancellation once", async () => {
      const at = new Date(Date.now() + 120_000).toISOString();
      const res = await billing.handlePaddleEvent(subEvent("subscription.canceled", { status: "canceled", canceled_at: at, current_billing_period: null }, at));
      expect(res.outcome).toBe("applied");
      await billing.handlePaddleEvent(subEvent("subscription.canceled", { status: "canceled", canceled_at: at, current_billing_period: null }, at));
      const [s] = await sql`select billing_status, plan, canceled_at from subscribers where paddle_subscription_id = ${SUB_ID}`;
      expect(s).toMatchObject({ billing_status: "canceled", plan: "free" });
      expect((await sql`select count(*)::int as n from events where type = 'subscription_canceled'`)[0].n).toBe(1);
    });

    it("an existing address is only changed once Paddle reports its subscription", async () => {
      await sql`insert into subscribers (email, status, premium_waitlist, unsubscribe_token) values ('waiting@example.org', 'confirmed', true, 'unsub-waiting')`;
      const res = await billing.startCheckout({ email: "waiting@example.org", plan: "monthly", search: "category=health" });
      const wref = (res as { ref: string }).ref;
      const [before] = await sql`select id, billing_status from subscribers where email = 'waiting@example.org'`;
      expect(before.billing_status).toBe("none");
      expect(await sql`select 1 from saved_searches where subscriber_id = ${before.id}`).toHaveLength(0);

      await billing.handlePaddleEvent(subEvent("subscription.created", {
        id: SUB_ID_2, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3ky5", custom_data: { ref: wref }, billing_cycle: { interval: "month", frequency: 1 },
      }));
      const [after] = await sql`select billing_status, plan_interval from subscribers where email = 'waiting@example.org'`;
      expect(after).toMatchObject({ billing_status: "trialing", plan_interval: "month" });
      expect((await sql`select search from saved_searches where subscriber_id = ${before.id}`).map((r: { search: string }) => r.search)).toEqual(["category=health"]);
      // It wasn't created by that checkout, so the browser gets no link (it's emailed instead).
      expect((await billing.checkoutAccountToken(wref)).manageToken).toBeNull();
      // A second checkout for an address that already has a running subscription is refused.
      const again = await billing.startCheckout({ email: "waiting@example.org", plan: "monthly", search: null });
      expect(again).toMatchObject({ ok: true, alreadySubscribed: true });
    });

    it("leaves unknown subscriptions alone", async () => {
      const res = await billing.handlePaddleEvent(subEvent("subscription.created", { id: "sub_01hv8x29kz0t586xy6zn1a6zzz", customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kzz" }));
      expect(res.outcome).toBe("unmatched");
    });

    it("the webhook route rejects a bad signature and accepts a signed event", async () => {
      const { POST } = await import("@/app/api/paddle/webhook/route");
      const body = JSON.stringify({ event_id: "evt_route_1", event_type: "customer.created", occurred_at: new Date().toISOString(), data: {} });
      const ts = Math.floor(Date.now() / 1000);
      const post = (sig: string) => POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": sig } }));
      expect((await post(`ts=${ts};h1=${"0".repeat(64)}`)).status).toBe(401);
      expect((await post(`ts=${ts - 3600};h1=${paddle.signPayload(body, ts - 3600, WEBHOOK_SECRET)}`)).status).toBe(401);
      const ok = await post(`ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("ignored");
      expect(await (await post(`ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}`)).text()).toBe("duplicate");
    });
  });

  describe("alert delivery", () => {
    let dailyId = 0, weeklyId = 0;

    async function addJob(title: string, firstSeenHoursAgo: number, extra: { demo?: boolean; deadline?: string | null } = {}) {
      const slug = title.toLowerCase().replace(/\W+/g, "-");
      await sql`
        insert into jobs (slug, title, organization_id, apply_url, apply_host, url_hash, status, is_demo, deadline, first_seen_at, published_at)
        values (${slug}, ${title}, (select id from organizations where slug = 'alert-agency'), ${`https://example.org/${slug}-${Math.random()}`}, 'example.org',
                ${`hash-${slug}-${Math.random()}`}, 'active', ${extra.demo ?? false}, ${extra.deadline === undefined ? null : extra.deadline},
                now() - make_interval(hours => ${firstSeenHoursAgo}), now() - make_interval(hours => ${firstSeenHoursAgo}))`;
    }

    beforeAll(async () => {
      await sql`insert into organizations (slug, name, logo_checked_at) values ('alert-agency', 'Alert Agency', now())`;
      const mk = async (email: string, frequency: string, billing: string) =>
        (await sql`
          insert into subscribers (email, status, wants_alerts, frequency, billing_status, unsubscribe_token)
          values (${email}, 'confirmed', true, ${frequency}, ${billing}, ${`unsub-${email}`}) returning id::int as id`)[0].id;
      dailyId = await mk("daily@example.org", "daily", "active");
      weeklyId = await mk("weekly@example.org", "weekly", "trialing");
      const canceledId = await mk("gone@example.org", "daily", "canceled");
      const unsubId = await mk("quiet@example.org", "daily", "active");
      await sql`update subscribers set status = 'unsubscribed' where id = ${unsubId}`;
      for (const id of [dailyId, weeklyId, canceledId, unsubId]) {
        await sql`insert into saved_searches (subscriber_id, search, label) values (${id}, 'q=nurse', 'Nurse jobs')`;
      }
      await sql`insert into saved_searches (subscriber_id, search, label) values (${dailyId}, 'q=pilot', 'Pilot jobs')`;
      // The earlier tests' subscribers are not part of this delivery test.
      await sql`update subscribers set billing_status = 'canceled' where email not like '%@example.org' or email in ('new.person@example.org', 'waiting@example.org')`;

      await addJob("Nurse coordinator", 2);                        // new, matches
      await addJob("Senior nurse", 30);                            // older than a day: weekly only
      await addJob("Nurse trainer (demo)", 1, { demo: true });     // demo listings never go out
      await addJob("Nurse closed", 1, { deadline: "2020-01-01" }); // closed
      await addJob("Accountant", 1);                               // doesn't match
      await addJob("Nurse old", 24 * 20);                          // too old for anyone
    });

    it("sends one email per due subscriber with only new, open matches", async () => {
      const res = await digest.runAlerts();
      expect(res).toMatchObject({ status: "sent", due: 2, sent: 2, failed: 0 });
      const byTo = Object.fromEntries(sent.map((m) => [m.to, m]));
      expect(Object.keys(byTo).sort()).toEqual(["daily@example.org", "weekly@example.org"]);
      expect(byTo["daily@example.org"].text).toContain("Nurse coordinator");
      expect(byTo["daily@example.org"].text).not.toContain("Senior nurse");
      expect(byTo["weekly@example.org"].text).toContain("Senior nurse");
      for (const m of sent) {
        expect(m.text).not.toMatch(/demo|Nurse closed|Accountant|Nurse old/);
        expect(m.text).toContain("/account?t=");
        expect(m.headers?.["List-Unsubscribe"]).toContain("/api/unsubscribe?token=");
      }
      const unsent = await sql`select count(*)::int as n from saved_searches where last_sent_at is null and subscriber_id in (${dailyId}, ${weeklyId})`;
      expect(unsent[0].n).toBe(0);
    });

    it("does not send again on a second run the same day", async () => {
      await addJob("Nurse adviser", 0);
      const res = await digest.runAlerts();
      expect(res.sent).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it("next day: daily subscribers get only what is new since the last email; weekly ones wait", async () => {
      // Move the clock 21 hours on: everything in the past moves back by 21 hours.
      await sql`update saved_searches set last_sent_at = last_sent_at - interval '21 hours'`;
      await sql`update jobs set first_seen_at = first_seen_at - interval '21 hours', published_at = published_at - interval '21 hours'`;
      const res = await digest.runAlerts();
      expect(res).toMatchObject({ due: 1, sent: 1 });
      expect(sent.map((m) => m.to)).toEqual(["daily@example.org"]);
      expect(sent[0].text).toContain("Nurse adviser");
      expect(sent[0].text).not.toContain("Nurse coordinator");
    });

    it("a due subscriber with no new matches gets nothing and stays due", async () => {
      await sql`update saved_searches set last_sent_at = now() - interval '7 days' where subscriber_id = ${weeklyId}`;
      await sql`update jobs set first_seen_at = now() - interval '30 days' where title like 'Nurse%' or title = 'Senior nurse'`;
      const res = await digest.runAlerts();
      expect(res.empty).toBe(1);
      expect(sent).toHaveLength(0);
      const [row] = await sql`select max(last_sent_at) < now() - interval '6 days' as still_due from saved_searches where subscriber_id = ${weeklyId}`;
      expect(row.still_due).toBe(true);
    });

    it("the weekly digest never goes to paying subscribers", async () => {
      await addJob("Logistics officer", 1);
      await digest.runDigest({ force: true });
      expect(sent.filter((m) => ["daily@example.org", "weekly@example.org"].includes(m.to))).toHaveLength(0);
    });
  });
  describe("webhook events survive a killed run (one transaction)", () => {
    const KILLED_SUB = "sub_01hv8x29kz0t586xy6zn1a63aa";

    it("a run killed after recording the event leaves nothing behind, and Paddle's retry applies it", async () => {
      const start = await billing.startCheckout({ email: "killed@example.org", plan: "monthly", search: null });
      const ref = (start as { ref: string }).ref;
      const ev = subEvent("subscription.created", { id: KILLED_SUB, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3ka1", custom_data: { ref }, billing_cycle: { interval: "month", frequency: 1 } });

      // Make the subscriber update hang, so the run can be killed in the middle of the transaction.
      await sql.unsafe(`
        create or replace function test_slow_update() returns trigger language plpgsql as $$ begin perform pg_sleep(5); return new; end $$;
        drop trigger if exists test_slow_update on subscribers;
        create trigger test_slow_update before update on subscribers for each row
          when (old.email = 'killed@example.org') execute function test_slow_update();`);
      try {
        const run = billing.handlePaddleEvent(ev).then(() => "finished", (e: Error) => e);
        let pid: number | null = null;
        for (let i = 0; i < 100 && !pid; i++) {
          const [row] = await sql`select pid from pg_stat_activity where datname = current_database() and wait_event = 'PgSleep'`;
          pid = row?.pid ?? null;
          if (!pid) await new Promise((r) => setTimeout(r, 50));
        }
        expect(pid).not.toBeNull();
        // While the run is inside the transaction, its event record isn't visible (not committed separately).
        expect((await sql`select count(*)::int as n from paddle_events where event_id = ${ev.event_id}`)[0].n).toBe(0);
        // Kill it, the way a host stops a function: the connection goes away and no JavaScript clean-up runs.
        await sql`select pg_terminate_backend(${pid})`;
        expect(await run).toBeInstanceOf(Error);
      } finally {
        await sql.unsafe("drop trigger if exists test_slow_update on subscribers; drop function if exists test_slow_update();");
      }

      expect((await sql`select count(*)::int as n from paddle_events where event_id = ${ev.event_id}`)[0].n).toBe(0);
      const [before] = await sql`select billing_status, paddle_subscription_id from subscribers where email = 'killed@example.org'`;
      expect(before).toMatchObject({ billing_status: "none", paddle_subscription_id: null });

      // Paddle retries the same event: it is applied, not treated as a duplicate.
      const retry = await billing.handlePaddleEvent(ev);
      expect(retry.outcome).toBe("applied");
      const [after] = await sql`select status, billing_status, paddle_subscription_id from subscribers where email = 'killed@example.org'`;
      expect(after).toMatchObject({ status: "confirmed", billing_status: "trialing", paddle_subscription_id: KILLED_SUB });
      expect((await billing.handlePaddleEvent(ev)).outcome).toBe("duplicate");
    });
  });

  describe("checkout with an address that already exists", () => {
    beforeAll(async () => {
      // Earlier subscribers are done with their welcome emails.
      await sql`update subscribers set welcome_sent_at = coalesce(welcome_sent_at, now())`;
    });

    it("an unsubscribed address stays unsubscribed and gets a confirmation link, not the welcome", async () => {
      await sql`
        insert into subscribers (email, status, unsubscribed_at, unsubscribe_token)
        values ('gone-away@example.org', 'unsubscribed', now() - interval '3 days', 'unsub-gone-away')`;
      const start = await billing.startCheckout({ email: "gone-away@example.org", plan: "quarterly", search: "q=water" });
      const ref = (start as { ref: string }).ref;
      const subId = "sub_01hv8x29kz0t586xy6zn1a63ab";
      const { POST } = await import("@/app/api/paddle/webhook/route");
      const body = JSON.stringify(subEvent("subscription.created", { id: subId, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3ka2", custom_data: { ref } }));
      const ts = Math.floor(Date.now() / 1000);
      const res = await POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
      expect(await res.text()).toBe("applied");
      await settle();

      const [s] = await sql`select id::int as id, status, billing_status, paddle_subscription_id, welcome_sent_at, unsubscribed_at, confirm_token from subscribers where email = 'gone-away@example.org'`;
      expect(s).toMatchObject({ status: "unsubscribed", billing_status: "trialing", paddle_subscription_id: subId, welcome_sent_at: null });
      expect(s.unsubscribed_at).not.toBeNull();
      expect(s.confirm_token).toBeTruthy();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "gone-away@example.org", key: `paid-confirm:${s.id}:${subId}`, replyTo: "info@nuevanova.com" });
      expect(sent[0].subject).toMatch(/^Confirm your email/);
      expect(sent[0].text).toContain(`/alerts/confirm?token=${s.confirm_token}`);
      expect(sent[0].text).not.toContain("/account?t=");

      // Not confirmed: no welcome from the daily job, no alerts.
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });

      // The owner confirms; the daily job then sends the welcome, once.
      expect((await subscribers.confirmSubscriber(s.confirm_token)).ok).toBe(true);
      const [c] = await sql`select status, unsubscribed_at from subscribers where id = ${s.id}`;
      expect(c).toMatchObject({ status: "confirmed", unsubscribed_at: null });
      sent.length = 0;
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent[0]).toMatchObject({ to: "gone-away@example.org", key: `welcome:${s.id}` });
      expect(sent[0].text).toContain("/account?t=");
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });
    });

    it("a pending address stays pending and keeps its confirmation token", async () => {
      await sql`insert into subscribers (email, status, confirm_token, unsubscribe_token) values ('maybe@example.org', 'pending', 'tok-maybe-0123456789', 'unsub-maybe')`;
      const start = await billing.startCheckout({ email: "maybe@example.org", plan: "monthly", search: null });
      const res = await billing.handlePaddleEvent(subEvent("subscription.created", {
        id: "sub_01hv8x29kz0t586xy6zn1a63ac", customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3ka3", custom_data: { ref: (start as { ref: string }).ref },
      }));
      expect(res.welcome).toBeUndefined();
      expect(res.confirm).toMatchObject({ email: "maybe@example.org", confirmToken: "tok-maybe-0123456789" });
      const [s] = await sql`select status, billing_status from subscribers where email = 'maybe@example.org'`;
      expect(s).toMatchObject({ status: "pending", billing_status: "trialing" });
    });
  });

  describe("plan emails", () => {
    async function mk(email: string, over: { status?: string; billing?: string; trialEndsInDays?: number | null; cancel?: boolean; interval?: string; periodEndInDays?: number } = {}) {
      const [r] = await sql`
        insert into subscribers (email, status, wants_alerts, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at, unsubscribe_token, welcome_sent_at)
        values (${email}, ${over.status ?? "confirmed"}, true, ${over.billing ?? "trialing"}, ${over.interval ?? "quarter"},
                ${over.trialEndsInDays == null ? null : sql`now() + make_interval(days => ${over.trialEndsInDays})`},
                ${over.periodEndInDays == null ? null : sql`now() + make_interval(days => ${over.periodEndInDays})`},
                ${over.cancel ? sql`now() + interval '2 days'` : null}, ${`unsub-${email}`}, now())
        returning id::int as id, manage_token`;
      return r as { id: number; manage_token: string };
    }

    it("reminds each trialing subscriber once, about 3 days before the first payment", async () => {
      const due = await mk("trial-ends@example.org", { trialEndsInDays: 2 });
      const quiet = await mk("trial-quiet@example.org", { status: "unsubscribed", trialEndsInDays: 2, interval: "month" });
      await mk("trial-later@example.org", { trialEndsInDays: 10 });
      await mk("trial-canceled@example.org", { trialEndsInDays: 2, cancel: true });
      const res = await notices.runTrialReminders();
      expect(res).toEqual({ sent: 2, failed: 0 });
      const byTo = Object.fromEntries(sent.map((m) => [m.to, m]));
      expect(Object.keys(byTo).sort()).toEqual(["trial-ends@example.org", "trial-quiet@example.org"]);
      const m = byTo["trial-ends@example.org"];
      expect(m.subject).toMatch(/free trial ends on/);
      expect(m.text).toContain("$19.99");
      expect(m.text).toContain(`/account?t=${due.manage_token}`);
      expect(m.key).toMatch(new RegExp(`^trial-reminder:${due.id}:`));
      expect(byTo["trial-quiet@example.org"].text).toContain("$9.99");
      expect(byTo["trial-quiet@example.org"].text).toContain(`/account?t=${quiet.manage_token}`);
      sent.length = 0;
      expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
    });

    it("a later subscription with its own trial (e.g. made in Paddle's dashboard) gets its own reminder", async () => {
      const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
      const trial = (id: string, customer: string, ref: string | null, endsAt: string) => ({
        id, customer_id: customer, custom_data: ref ? { ref } : null,
        current_billing_period: { starts_at: inDays(-12), ends_at: endsAt }, next_billed_at: endsAt,
        items: [{ price: { id: "pri_test" }, trial_dates: { starts_at: inDays(-12), ends_at: endsAt } }],
      });
      const first = "sub_01hv8x29kz0t586xy6zn1a64aa", second = "sub_01hv8x29kz0t586xy6zn1a64ab";
      const customer = "ctm_01hv6y1jedq4p1n0yqn5ba3kb1";

      // First trial: reminded once.
      const start1 = await billing.startCheckout({ email: "returning@example.org", plan: "monthly", search: null });
      await billing.handlePaddleEvent(subEvent("subscription.created", trial(first, customer, (start1 as { ref: string }).ref, inDays(2))));
      expect(await notices.runTrialReminders()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => m.to)).toEqual(["returning@example.org"]);

      // Canceled. The site gives no second trial (one per person; without an API key no
      // checkout at all), but a subscription with a trial made elsewhere (Paddle's dashboard,
      // matched by customer) still gets its own reminder.
      const canceledAt = new Date(Date.now() + 1_000).toISOString();
      await billing.handlePaddleEvent(subEvent("subscription.canceled", { id: first, customer_id: customer, status: "canceled", canceled_at: canceledAt, current_billing_period: null }, canceledAt));
      expect((await sql`select billing_status from subscribers where email = 'returning@example.org'`)[0].billing_status).toBe("canceled");
      const start2 = await billing.startCheckout({ email: "returning@example.org", plan: "monthly", search: null });
      expect(start2).toEqual({ ok: false, error: billing.CHECKOUT_UNAVAILABLE, noTrial: true });
      const res = await billing.handlePaddleEvent(subEvent("subscription.created", trial(second, customer, null, inDays(1)), new Date(Date.now() + 2_000).toISOString()));
      expect(res.outcome).toBe("applied");
      const [s] = await sql`select billing_status, paddle_subscription_id, trial_reminder_sent_at from subscribers where email = 'returning@example.org'`;
      expect(s).toMatchObject({ billing_status: "trialing", paddle_subscription_id: second, trial_reminder_sent_at: null });

      sent.length = 0;
      expect(await notices.runTrialReminders()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => m.to)).toEqual(["returning@example.org"]);
      // A repeated snapshot of the same subscription does not reset it.
      await billing.handlePaddleEvent(subEvent("subscription.updated", trial(second, customer, null, inDays(1)), new Date(Date.now() + 3_000).toISOString()));
      sent.length = 0;
      expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
    });

    it("one-click unsubscribe with a running plan: unsubscribes and sends one notice with the cancel link", async () => {
      const acct = await mk("oneclick@example.org", { billing: "active", interval: "month", periodEndInDays: 20 });
      const { POST } = await import("@/app/api/unsubscribe/route");
      const post = () => POST(new Request("http://localhost/api/unsubscribe?token=unsub-oneclick@example.org", { method: "POST" }));
      expect((await post()).status).toBe(200);
      await settle();
      expect((await sql`select status from subscribers where id = ${acct.id}`)[0].status).toBe("unsubscribed");
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe("You've unsubscribed from Postbird alerts");
      expect(sent[0].text).toMatch(/You've unsubscribed from Postbird alerts\. Your plan is still active and renews on .+ for \$9\.99\./);
      expect(sent[0].text).toContain(`To stop being charged, cancel here: http://localhost:3000/account?t=${acct.manage_token}`);
      expect(sent[0].key).toMatch(new RegExp(`^unsubscribed-plan:${acct.id}:`));
      // A second click changes nothing and sends nothing.
      expect((await post()).status).toBe(200);
      await settle();
      expect(sent).toHaveLength(1);
    });

    it("one-click unsubscribe without a plan sends nothing", async () => {
      await sql`insert into subscribers (email, status, unsubscribe_token) values ('free@example.org', 'confirmed', 'unsub-free')`;
      const { POST } = await import("@/app/api/unsubscribe/route");
      await POST(new Request("http://localhost/api/unsubscribe?token=unsub-free", { method: "POST" }));
      await settle();
      expect(sent).toHaveLength(0);
      expect((await sql`select status from subscribers where email = 'free@example.org'`)[0].status).toBe("unsubscribed");
    });

    it("emailing the account link replaces it; old links stop working and alerts carry the new one", async () => {
      const acct = await mk("rotate@example.org", { billing: "active", periodEndInDays: 20 });
      expect(await account.sendAccountLink("rotate@example.org")).toBe(true);
      const [{ manage_token: fresh }] = await sql`select manage_token from subscribers where id = ${acct.id}`;
      expect(fresh).not.toBe(acct.manage_token);
      expect(account.isManageToken(fresh)).toBe(true);
      expect(await account.findByManageToken(acct.manage_token)).toBeNull();
      expect((await account.findByManageToken(fresh))?.email).toBe("rotate@example.org");
      expect(sent[0].text).toContain(`/account?t=${fresh}`);
      expect(sent[0].key).toMatch(new RegExp(`^account-link:${acct.id}:[0-9a-f]{16}$`));

      // The next alert links to the current account page.
      sent.length = 0;
      await sql`insert into saved_searches (subscriber_id, search, label) values (${acct.id}, '', 'All new vacancies')`;
      await sql`
        insert into jobs (slug, title, apply_url, apply_host, url_hash, status, first_seen_at, published_at)
        values ('rotation-check', 'Rotation check officer', 'https://example.org/rotation-check', 'example.org', 'hash-rotation-check', 'active', now() - interval '1 hour', now() - interval '1 hour')`;
      await digest.runAlerts();
      const alert = sent.find((m) => m.to === "rotate@example.org");
      expect(alert?.text).toContain(`/account?t=${fresh}`);
      expect(alert?.key).toMatch(/^alerts:[0-9a-f]{40}$/);
    });

    it("emails the early-access list once, only confirmed members without a plan", async () => {
      const add = async (email: string, status: string, billing = "none") =>
        sql`insert into subscribers (email, status, premium_waitlist, billing_status, unsubscribe_token) values (${email}, ${status}, true, ${billing}, ${`unsub-${email}`})`;
      await add("early1@example.org", "confirmed");
      await add("early2@example.org", "pending");
      await add("early3@example.org", "confirmed", "trialing");
      // Had a plan (a trial, canceled): the email offers the free trial, so not to them.
      await add("early4@example.org", "confirmed", "canceled");
      const res = await notices.notifyWaitlist();
      expect(res.ok).toBe(true);
      const to = sent.map((m) => m.to);
      expect(to).toContain("early1@example.org");
      expect(to).not.toContain("early2@example.org");
      expect(to).not.toContain("early3@example.org");
      expect(to).not.toContain("early4@example.org");
      const m = sent.find((x) => x.to === "early1@example.org")!;
      expect(m.subject).toBe("Postbird email alerts are open");
      expect(m.text).toContain("/pricing/trial");
      expect(m.text).toContain("/alerts/unsubscribe?token=unsub-early1@example.org");
      expect(m.text).toContain("Casper, Wyoming");
      expect(m.headers?.["List-Unsubscribe"]).toContain("/api/unsubscribe?token=");
      expect((await sql`select waitlist_notified_at from subscribers where email = 'early1@example.org'`)[0].waitlist_notified_at).not.toBeNull();
      sent.length = 0;
      expect((await notices.notifyWaitlist()).sent).toBe(0);
      expect(sent).toHaveLength(0);
    });
  });

  describe("sign-up confirmations", () => {
    it("sends at most 3 confirmation emails per address in 24 hours, on top of the 5-minute gap", async () => {
      const email = "flooded@example.org";
      const signupOnce = async () => {
        expect(await subscribers.signup({ email, kind: "alerts", source: "test" })).toEqual({ ok: true, state: "check_email" });
        // Step past the 5-minute gap.
        await sql`update subscribers set confirm_sent_at = now() - interval '10 minutes' where email = ${email}`;
      };
      for (let i = 0; i < 5; i++) await signupOnce();
      expect(sent.filter((m) => m.to === email)).toHaveLength(3);
      // Within 5 minutes of a send, nothing more goes out either.
      await sql`delete from rate_limits`;
      await subscribers.signup({ email, kind: "alerts" });
      await subscribers.signup({ email, kind: "alerts" });
      expect(sent.filter((m) => m.to === email)).toHaveLength(4);
      // Another address is not affected.
      await subscribers.signup({ email: "other-flood@example.org", kind: "waitlist" });
      expect(sent.filter((m) => m.to === "other-flood@example.org")).toHaveLength(1);
    });
  });

  describe("retention", () => {
    it("deletes canceled plans and notified early-access-only addresses after 30 days, with their saved searches", async () => {
      const ins = async (email: string, o: { billing?: string; canceledDaysAgo?: number; waitlistNotifiedDaysAgo?: number }) =>
        (await sql`
          insert into subscribers (email, status, premium_waitlist, billing_status, canceled_at, waitlist_notified_at, unsubscribe_token)
          values (${email}, 'confirmed', ${o.waitlistNotifiedDaysAgo != null}, ${o.billing ?? "none"},
                  ${o.canceledDaysAgo == null ? null : sql`now() - make_interval(days => ${o.canceledDaysAgo})`},
                  ${o.waitlistNotifiedDaysAgo == null ? null : sql`now() - make_interval(days => ${o.waitlistNotifiedDaysAgo})`},
                  ${`unsub-${email}`})
          returning id::int as id`)[0].id as number;
      const oldCancel = await ins("old-cancel@example.org", { billing: "canceled", canceledDaysAgo: 40 });
      await sql`insert into saved_searches (subscriber_id, search, label) values (${oldCancel}, 'q=old', 'Old')`;
      await sql`insert into paddle_checkouts (ref, subscriber_id, plan, created_at) values ('ref-old-cancel-0123456789', ${oldCancel}, 'monthly', now() - interval '35 days')`;
      await ins("new-cancel@example.org", { billing: "canceled", canceledDaysAgo: 10 });
      await ins("early-old@example.org", { waitlistNotifiedDaysAgo: 40 });
      await ins("early-new@example.org", { waitlistNotifiedDaysAgo: 10 });
      // Joined early access, was emailed, started a trial and canceled it 5 days ago: kept for now.
      await ins("early-trial@example.org", { waitlistNotifiedDaysAgo: 40, billing: "canceled", canceledDaysAgo: 5 });

      await subscribers.purgeStaleSubscribers();
      const left = (await sql`select email from subscribers where email in ('old-cancel@example.org', 'new-cancel@example.org', 'early-old@example.org', 'early-new@example.org', 'early-trial@example.org') order by email`)
        .map((r: { email: string }) => r.email);
      expect(left).toEqual(["early-new@example.org", "early-trial@example.org", "new-cancel@example.org"]);
      expect(await sql`select 1 from saved_searches where subscriber_id = ${oldCancel}`).toHaveLength(0);
      expect(await sql`select 1 from paddle_checkouts where created_at < now() - interval '30 days'`).toHaveLength(0);
    });
  });

  describe("a checkout tried twice for a new address", () => {
    const postEvent = async (event: ReturnType<typeof subEvent>) => {
      const { POST } = await import("@/app/api/paddle/webhook/route");
      const body = JSON.stringify(event);
      const ts = Math.floor(Date.now() / 1000);
      return POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
    };

    it("paying through the second checkout confirms the address and the welcome goes out", async () => {
      const first = await billing.startCheckout({ email: "twice@example.org", plan: "monthly", search: "q=nurse" });
      const second = await billing.startCheckout({ email: "twice@example.org", plan: "quarterly", search: "q=nurse" });
      const ref2 = (second as { ref: string }).ref;
      expect(ref2).not.toBe((first as { ref: string }).ref);
      const checkouts = await sql`select new_subscriber from paddle_checkouts c join subscribers s on s.id = c.subscriber_id where s.email = 'twice@example.org' order by c.created_at`;
      expect(checkouts.map((c: { new_subscriber: boolean }) => c.new_subscriber)).toEqual([true, true]);

      const subId = "sub_01hv8x29kz0t586xy6zn1a65aa";
      const res = await postEvent(subEvent("subscription.created", { id: subId, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kc1", custom_data: { ref: ref2 } }));
      expect(await res.text()).toBe("applied");
      await settle();
      const [s] = await sql`select id::int as id, status, billing_status, confirmed_at, welcome_sent_at, welcome_claimed_at, manage_token from subscribers where email = 'twice@example.org'`;
      expect(s).toMatchObject({ status: "confirmed", billing_status: "trialing", welcome_claimed_at: null });
      expect(s.confirmed_at).not.toBeNull();
      expect(s.welcome_sent_at).not.toBeNull();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "twice@example.org", key: `welcome:${s.id}` });
      expect(sent[0].text).toContain(`/account?t=${s.manage_token}`);
      expect(await billing.checkoutAccountToken(ref2)).toEqual({ linked: true, manageToken: s.manage_token });
    });

    it("an address its owner touched in between (a sign-up) is not confirmed by paying", async () => {
      await billing.startCheckout({ email: "touched@example.org", plan: "monthly", search: null });
      await subscribers.signup({ email: "touched@example.org", kind: "alerts" });
      const second = await billing.startCheckout({ email: "touched@example.org", plan: "monthly", search: null });
      const [c] = await sql`select new_subscriber from paddle_checkouts where ref = ${(second as { ref: string }).ref}`;
      expect(c.new_subscriber).toBe(false);
      const res = await billing.handlePaddleEvent(subEvent("subscription.created", {
        id: "sub_01hv8x29kz0t586xy6zn1a65ab", customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kc2", custom_data: { ref: (second as { ref: string }).ref },
      }));
      expect(res.welcome).toBeUndefined();
      expect(res.confirm?.email).toBe("touched@example.org");
      expect((await sql`select status from subscribers where email = 'touched@example.org'`)[0].status).toBe("pending");
    });
  });

  describe("plan emails claimed but never sent (leases)", () => {
    async function claimed(email: string, over: Record<string, unknown>) {
      const [r] = await sql`
        insert into subscribers (email, status, wants_alerts, billing_status, plan_interval, unsubscribe_token)
        values (${email}, ${over.status ?? "confirmed"}, true, 'trialing', 'month', ${`unsub-${email}`})
        returning id::int as id`;
      await sql`update subscribers set ${sql(over, Object.keys(over).filter((k) => k !== "status"))} where id = ${r.id}`;
      return r.id as number;
    }
    const ago = (mins: number) => new Date(Date.now() - mins * 60_000);

    it("a welcome claimed over 30 minutes ago and never sent goes out once, under the same key; a fresh claim waits", async () => {
      await sql`update subscribers set welcome_sent_at = coalesce(welcome_sent_at, now()), welcome_claimed_at = null`;
      const stale = await claimed("lease-welcome@example.org", { welcome_sent_at: ago(45), welcome_claimed_at: ago(45) });
      const fresh = await claimed("lease-fresh@example.org", { welcome_sent_at: ago(5), welcome_claimed_at: ago(5) });
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => [m.to, m.key])).toEqual([["lease-welcome@example.org", `welcome:${stale}`]]);
      const [s] = await sql`select welcome_sent_at, welcome_claimed_at from subscribers where id = ${stale}`;
      expect(s.welcome_sent_at).not.toBeNull();
      expect(s.welcome_claimed_at).toBeNull();
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });
      expect((await sql`select welcome_claimed_at from subscribers where id = ${fresh}`)[0].welcome_claimed_at).not.toBeNull();
    });

    it("a failed send gives the claim back; the next run sends it", async () => {
      const id = await claimed("lease-fail@example.org", { welcome_sent_at: null });
      const resendStub = globalThis.fetch;
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ name: "validation_error", message: "nope" }), { status: 422 }));
      try {
        expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 1 });
      } finally {
        vi.stubGlobal("fetch", resendStub);
      }
      expect((await sql`select welcome_sent_at, welcome_claimed_at from subscribers where id = ${id}`)[0]).toMatchObject({ welcome_sent_at: null, welcome_claimed_at: null });
    });

    it("confirmation links and trial reminders left claimed are sent again with their stable keys", async () => {
      // Earlier subscribers are done with these emails.
      await sql`update subscribers set confirm_claimed_at = null, trial_reminder_sent_at = coalesce(trial_reminder_sent_at, now()), trial_reminder_claimed_at = null`;
      const subId = "sub_01hv8x29kz0t586xy6zn1a65ac";
      const conf = await claimed("lease-confirm@example.org", {
        status: "pending", confirm_token: "tok-lease-confirm-0123", paddle_subscription_id: subId,
        welcome_sent_at: ago(60), confirm_sent_at: ago(40), confirm_claimed_at: ago(40),
      });
      const trialEnds = new Date(Date.now() + 2 * 86_400_000);
      const remind = await claimed("lease-trial@example.org", {
        welcome_sent_at: ago(60), trial_ends_at: trialEnds, trial_reminder_sent_at: ago(40), trial_reminder_claimed_at: ago(40),
      });
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 1, failed: 0 });
      expect(await notices.runTrialReminders()).toEqual({ sent: 1, failed: 0 });
      const byTo = Object.fromEntries(sent.map((m) => [m.to, m.key]));
      expect(byTo["lease-confirm@example.org"]).toBe(`paid-confirm:${conf}:${subId}`);
      const [{ trial_ends_at }] = await sql`select trial_ends_at from subscribers where id = ${remind}`;
      expect(byTo["lease-trial@example.org"]).toBe(`trial-reminder:${remind}:${new Date(trial_ends_at).toISOString()}`);
      const rows = await sql`select confirm_claimed_at, trial_reminder_claimed_at from subscribers where id in (${conf}, ${remind})`;
      for (const r of rows) expect(r).toEqual({ confirm_claimed_at: null, trial_reminder_claimed_at: null });
      sent.length = 0;
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 0, failed: 0 });
      expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
      expect(sent).toHaveLength(0);
    });
  });

  describe("account link emails", () => {
    it("at most 5 per address in 24 hours, with the same answer and no new link after that", async () => {
      await sql`delete from rate_limits`;
      await sql`insert into subscribers (email, status, unsubscribe_token) values ('capped@example.org', 'confirmed', 'unsub-capped')`;
      for (let i = 0; i < 7; i++) expect(await account.sendAccountLink("capped@example.org")).toBe(true);
      expect(sent.filter((m) => m.to === "capped@example.org")).toHaveLength(account.ACCOUNT_LINKS_PER_DAY);
      // Over the cap the link isn't replaced either: the last emailed link still works.
      const [{ manage_token }] = await sql`select manage_token from subscribers where email = 'capped@example.org'`;
      expect(sent.filter((m) => m.to === "capped@example.org").at(-1)?.text).toContain(`/account?t=${manage_token}`);
      // An address without an account gets the same answer.
      for (let i = 0; i < 7; i++) expect(await account.sendAccountLink("nobody-here@example.org")).toBe(true);
      // Another address is not affected.
      await sql`insert into subscribers (email, status, unsubscribe_token) values ('uncapped@example.org', 'confirmed', 'unsub-uncapped')`;
      expect(await account.sendAccountLink("uncapped@example.org")).toBe(true);
      expect(sent.filter((m) => m.to === "uncapped@example.org")).toHaveLength(1);
    });
  });

  describe("UN and EU emblems", () => {
    it("never serves or keeps an icon for a UN system organization or EU institution", async () => {
      const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000040000000400806000000", "hex");
      await sql`insert into organizations (slug, name, org_type, logo, logo_type) values
        ('un-agency', 'UN Agency', 'UN system', ${png}, 'image/png'),
        ('eu-body', 'EU Body', 'EU institution', ${png}, 'image/png'),
        ('ngo-x', 'NGO X', 'NGO', ${png}, 'image/png')`;
      const { GET } = await import("@/app/api/org-logo/[slug]/route");
      const get = (slug: string) => GET(new Request(`http://localhost/api/org-logo/${slug}`), { params: Promise.resolve({ slug }) });
      expect((await get("un-agency")).status).toBe(404);
      expect((await get("eu-body")).status).toBe(404);
      expect((await get("ngo-x")).status).toBe(200);
      const { clearProtectedLogos } = await import("@/lib/feeds/logos");
      expect(await clearProtectedLogos()).toBe(2);
      const rows = await sql`select slug from organizations where logo is not null and slug in ('un-agency', 'eu-body', 'ngo-x')`;
      expect(rows.map((r: { slug: string }) => r.slug)).toEqual(["ngo-x"]);
    });
  });

  describe("filter counts", () => {
    it("the shared count query matches direct counts, and calls made together share it", async () => {
      const jobs = await import("@/lib/jobs");
      const [stats, countries, regions, categories, langs] = await Promise.all([
        jobs.siteStats(), jobs.countryFacets(), jobs.regionFacets(), jobs.categoryFacets(), jobs.languageFacets(),
      ]);
      const [{ n }] = await sql`select count(*)::int as n from jobs where status = 'active' and (deadline is null or deadline >= (now() at time zone 'utc')::date)`;
      expect(stats.active).toBe(n);
      expect(categories.reduce((t, c) => t + c.count, 0)).toBe(n);
      expect(Array.isArray(countries) && Array.isArray(regions) && Array.isArray(langs)).toBe(true);
    });
  });
});
