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
const API_KEY = "pdl_sdbx_apikey_test_0123456789";

/**
 * The Paddle customers the API stub knows, with their email (GET /customers/{id}). The webhook
 * links a customer only when its email is the subscriber's address.
 */
const CUSTOMERS: Record<string, string> = {
  [CUSTOMER]: "New.Person@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3ky5: "waiting@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3ka2: "gone-away@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3ka3: "maybe@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3kb1: "returning@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3kc1: "twice@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3kc2: "touched@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3kd1: "someone-else@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3kd2: "unchecked@example.org",
};

/** A well-formed unsubscribe token for a test row (the routes only look up 20–64 characters of [A-Za-z0-9_-]). */
const tok = (email: string) => `unsub-${email.replace(/[^\w-]/g, "-")}`.padEnd(24, "x");

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
  const paddleCalls: string[] = [];
  let paddleDown = false;
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
    process.env.PADDLE_API_KEY = API_KEY;
    // The secret that keys trial markers (the site and the scheduled jobs must share it).
    process.env.ANALYTICS_SALT = "test-analytics-salt-0123456789";

    // Resend stub: records every message instead of sending it. Paddle stub: customers and cancels.
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.startsWith("https://sandbox-api.paddle.com/")) {
        paddleCalls.push(`${method} ${u.replace("https://sandbox-api.paddle.com", "")}`);
        if (paddleDown) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
        const ctm = u.match(/\/customers\/(ctm_\w+)$/)?.[1];
        if (method === "GET" && ctm && CUSTOMERS[ctm]) return Response.json({ data: { id: ctm, email: CUSTOMERS[ctm], status: "active" } });
        const cancel = u.match(/\/subscriptions\/(sub_\w+)\/cancel$/)?.[1];
        if (method === "POST" && cancel) return Response.json({ data: { id: cancel, status: "canceled" } });
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }
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
      jobs, job_sources, organizations, rate_limits, billing_flags, checkout_links, trial_markers restart identity cascade`);
    billing = await import("@/lib/billing/subscriptions");
    digest = await import("@/lib/digest");
    paddle = await import("@/lib/billing/paddle");
    notices = await import("@/lib/billing/notices");
    subscribers = await import("@/lib/subscribers");
    account = await import("@/lib/account");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    paddleCalls.length = 0;
    paddleDown = false;
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

    it("subscription.created links the subscription through customData; the new address must still be confirmed", async () => {
      const { POST } = await import("@/app/api/paddle/webhook/route");
      const body = JSON.stringify(subEvent("subscription.created", { custom_data: { ref } }));
      const ts = Math.floor(Date.now() / 1000);
      const res = await POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
      expect(await res.text()).toBe("applied");
      await settle();
      const [s] = await sql`
        select id::int as id, status, billing_status, plan, plan_interval, paddle_customer_id, paddle_customer_verified_at, paddle_subscription_id, trial_ends_at,
               welcome_sent_at, confirmed_at, confirm_token, confirm_sent_at, confirm_claimed_at
        from subscribers where email = 'new.person@example.org'`;
      // Anyone can type any address into the public form: paying doesn't confirm it.
      expect(s).toMatchObject({ status: "pending", billing_status: "trialing", plan: "premium", plan_interval: "quarter", paddle_customer_id: CUSTOMER, paddle_subscription_id: SUB_ID, welcome_sent_at: null, confirmed_at: null, confirm_claimed_at: null });
      // The customer was checked against the address (Paddle's email, compared case-insensitively) before it was linked.
      expect(s.paddle_customer_verified_at).not.toBeNull();
      expect(paddleCalls).toEqual([`GET /customers/${CUSTOMER}`]);
      expect(new Date(s.trial_ends_at).toISOString()).toBe("2026-11-23T10:00:00.000Z");
      // The confirmation email went out (and its claim was closed), not the welcome.
      expect(s.confirm_token).toBeTruthy();
      expect(s.confirm_sent_at).not.toBeNull();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "new.person@example.org", key: `paid-confirm:${s.id}:${SUB_ID}` });
      expect(sent[0].subject).toMatch(/^Confirm your email/);
      expect(sent[0].text).toContain(`/alerts/confirm?token=${s.confirm_token}`);
      // Written for whoever started the trial: its end, the price, the deadline to confirm, and
      // the account link (it works before confirming) to cancel straight away.
      expect(sent[0].text).toContain("You started a 14-day free trial of Postbird daily alerts. Confirm this address to start your alerts.");
      expect(sent[0].text).toContain("Your trial ends on 23 Nov 2026; then $19.99 every 3 months, renewing automatically until you cancel.");
      expect(sent[0].text).toContain("If you don't confirm by 21 Nov 2026, we cancel the trial and nothing is charged.");
      expect(sent[0].text).toContain("Didn't start this? Ignore this email and nothing will be charged.");
      expect(sent[0].text).toMatch(/Your account: http:\/\/localhost:3000\/account\?t=[0-9a-f]{64}/);
      const [ev] = await sql`select type, visitor, props from events where type = 'trial_started'`;
      expect(ev).toMatchObject({ visitor: "visitor-hash", props: { plan: "quarter", campaign: { msclkid: "abc123", utm_medium: "cpc" } } });
      // The browser that paid gets no account link: it comes with the welcome email, after confirming.
      expect(await billing.checkoutAccountToken(ref)).toEqual({ linked: true, manageToken: null });
      // No alerts and no welcome until the address is confirmed.
      sent.length = 0;
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });
      expect((await sql`select 1 from subscribers where id = ${s.id} and status = 'confirmed' and billing_status in ('trialing', 'active')`)).toHaveLength(0);

      // The owner confirms: the welcome goes out once, with the account link.
      expect((await subscribers.confirmSubscriber(s.confirm_token)).ok).toBe(true);
      const [c] = await sql`select status, confirmed_at, manage_token from subscribers where id = ${s.id}`;
      expect(c.status).toBe("confirmed");
      expect(c.confirmed_at).not.toBeNull();
      expect(await notices.runWelcomeRetries(1, s.id)).toEqual({ sent: 1, failed: 0 });
      expect(sent[0]).toMatchObject({ to: "new.person@example.org", key: `welcome:${s.id}:${SUB_ID}` });
      expect(sent[0].text).toContain(`/account?t=${c.manage_token}`);
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });
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
      // A second checkout for an address that already has a running subscription doesn't reach Paddle:
      // the page says "check your inbox", and the account link goes to the address.
      const again = await billing.startCheckout({ email: "waiting@example.org", plan: "monthly", search: null });
      expect(again).toEqual({ ok: true, inbox: true, email: "waiting@example.org", subscriberId: Number(before.id), live: true });
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
      // Applied in full; the new address still waits for its owner's confirmation.
      expect(after).toMatchObject({ status: "pending", billing_status: "trialing", paddle_subscription_id: KILLED_SUB });
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
      expect(sent[0].text).toMatch(/\/account\?t=[0-9a-f]{64}/);

      // Not confirmed: no welcome from the daily job, no alerts.
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });

      // The owner confirms; the daily job then sends the welcome, once.
      expect((await subscribers.confirmSubscriber(s.confirm_token)).ok).toBe(true);
      const [c] = await sql`select status, unsubscribed_at from subscribers where id = ${s.id}`;
      expect(c).toMatchObject({ status: "confirmed", unsubscribed_at: null });
      sent.length = 0;
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent[0]).toMatchObject({ to: "gone-away@example.org", key: `welcome:${s.id}:${subId}` });
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
        insert into subscribers (email, status, confirmed_at, wants_alerts, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at, unsubscribe_token, welcome_sent_at)
        values (${email}, ${over.status ?? "confirmed"}, ${over.status === "pending" ? null : sql`now() - interval '20 days'`}, true, ${over.billing ?? "trialing"}, ${over.interval ?? "quarter"},
                ${over.trialEndsInDays == null ? null : sql`now() + make_interval(days => ${over.trialEndsInDays})`},
                ${over.periodEndInDays == null ? null : sql`now() + make_interval(days => ${over.periodEndInDays})`},
                ${over.cancel ? sql`now() + interval '2 days'` : null}, ${tok(email)}, now())
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

    it("a second trial for an address that had a subscription (e.g. made in Paddle's dashboard) is canceled, not applied", async () => {
      const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
      const trial = (id: string, customer: string, ref: string | null, endsAt: string) => ({
        id, customer_id: customer, custom_data: ref ? { ref } : null,
        current_billing_period: { starts_at: inDays(-12), ends_at: endsAt }, next_billed_at: endsAt,
        items: [{ price: { id: "pri_test" }, trial_dates: { starts_at: inDays(-12), ends_at: endsAt } }],
      });
      const first = "sub_01hv8x29kz0t586xy6zn1a64aa", second = "sub_01hv8x29kz0t586xy6zn1a64ab";
      const customer = "ctm_01hv6y1jedq4p1n0yqn5ba3kb1";

      // First trial, confirmed by the address's owner: reminded once.
      const start1 = await billing.startCheckout({ email: "returning@example.org", plan: "monthly", search: null });
      const created = await billing.handlePaddleEvent(subEvent("subscription.created", trial(first, customer, (start1 as { ref: string }).ref, inDays(2))));
      expect((await subscribers.confirmSubscriber(created.confirm!.confirmToken)).ok).toBe(true);
      expect(await notices.runTrialReminders()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => m.to)).toEqual(["returning@example.org"]);

      // Canceled. A second subscription with a trial, made elsewhere and matched by its (checked) customer:
      // one free trial per email address, so it is held back and canceled in Paddle at once.
      const canceledAt = new Date(Date.now() + 1_000).toISOString();
      await billing.handlePaddleEvent(subEvent("subscription.canceled", { id: first, customer_id: customer, status: "canceled", canceled_at: canceledAt, current_billing_period: null }, canceledAt));
      expect((await sql`select billing_status from subscribers where email = 'returning@example.org'`)[0].billing_status).toBe("canceled");
      const { POST } = await import("@/app/api/paddle/webhook/route");
      const body = JSON.stringify(subEvent("subscription.created", trial(second, customer, null, inDays(1)), new Date(Date.now() + 2_000).toISOString()));
      const ts = Math.floor(Date.now() / 1000);
      paddleCalls.length = 0;
      const res = await POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
      expect(await res.text()).toBe("flagged");
      await settle();
      expect(paddleCalls).toEqual([`POST /subscriptions/${second}/cancel`]);
      const [s] = await sql`select billing_status, plan, paddle_subscription_id from subscribers where email = 'returning@example.org'`;
      expect(s).toMatchObject({ billing_status: "canceled", plan: "free", paddle_subscription_id: first });
      const [f] = await sql`select kind, detail, resolved_at from billing_flags where subscription_id = ${second}`;
      expect(f).toMatchObject({ kind: "trial_blocked", resolved_at: null });
      expect(f.detail).toMatch(/^Canceled in Paddle at once/);
      sent.length = 0;
      expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });
      expect(sent).toHaveLength(0);
      // Paddle's own cancel event for it changes nothing either.
      paddleCalls.length = 0;
      const after = await billing.handlePaddleEvent(subEvent("subscription.canceled", { ...trial(second, customer, null, inDays(1)), status: "canceled", canceled_at: new Date().toISOString() }, new Date(Date.now() + 3_000).toISOString()));
      expect(after).toEqual({ outcome: "flagged" });
      expect(paddleCalls).toEqual([]);
      expect((await sql`select paddle_subscription_id from subscribers where email = 'returning@example.org'`)[0].paddle_subscription_id).toBe(first);
    });

    it("a trial canceled before the address was confirmed doesn't use up its trial", async () => {
      const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
      const first = "sub_01hv8x29kz0t586xy6zn1a64ac", second = "sub_01hv8x29kz0t586xy6zn1a64ad";
      const start1 = await billing.startCheckout({ email: "never-confirmed@example.org", plan: "monthly", search: null });
      const created = await billing.handlePaddleEvent(subEvent("subscription.created", { id: first, customer_id: null, custom_data: { ref: (start1 as { ref: string }).ref } }));
      expect(created.confirm?.email).toBe("never-confirmed@example.org");
      const at = new Date(Date.now() + 1_000).toISOString();
      await billing.handlePaddleEvent(subEvent("subscription.canceled", { id: first, customer_id: null, status: "canceled", canceled_at: at, current_billing_period: null }, at));
      const [s] = await sql`select id::int as id, status, billing_status, confirmed_at from subscribers where email = 'never-confirmed@example.org'`;
      expect(s).toMatchObject({ status: "pending", billing_status: "canceled", confirmed_at: null });

      // The form opens the trial checkout again, and the new trial is applied, not blocked.
      const start2 = await billing.startCheckout({ email: "never-confirmed@example.org", plan: "quarterly", search: null });
      expect(start2).toMatchObject({ ok: true, trial: true });
      const res = await billing.handlePaddleEvent(subEvent("subscription.created", {
        id: second, customer_id: null, custom_data: { ref: (start2 as { ref: string }).ref },
        current_billing_period: { starts_at: inDays(0), ends_at: inDays(14) }, items: [{ price: { id: "pri_test" }, trial_dates: { starts_at: inDays(0), ends_at: inDays(14) } }],
      }, new Date(Date.now() + 2_000).toISOString()));
      expect(res.outcome).toBe("applied");
      expect(res.confirm?.subscriptionId).toBe(second);
      expect((await sql`select billing_status, paddle_subscription_id from subscribers where id = ${s.id}`)[0]).toMatchObject({ billing_status: "trialing", paddle_subscription_id: second });
      expect(await sql`select 1 from billing_flags where subscription_id = ${second}`).toHaveLength(0);
    });

    it("one-click unsubscribe with a running plan: unsubscribes and sends one notice with the cancel link", async () => {
      const acct = await mk("oneclick@example.org", { billing: "active", interval: "month", periodEndInDays: 20 });
      const { POST } = await import("@/app/api/unsubscribe/route");
      const post = () => POST(new Request(`http://localhost/api/unsubscribe?token=${tok("oneclick@example.org")}`, { method: "POST" }));
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
      await sql`insert into subscribers (email, status, unsubscribe_token) values ('free@example.org', 'confirmed', ${tok("free@example.org")})`;
      const { POST } = await import("@/app/api/unsubscribe/route");
      // A malformed token (here with a NUL byte) is not looked up at all, and changes nothing.
      expect((await POST(new Request("http://localhost/api/unsubscribe?token=unsub%00free", { method: "POST" }))).status).toBe(200);
      expect((await sql`select status from subscribers where email = 'free@example.org'`)[0].status).toBe("confirmed");
      await POST(new Request(`http://localhost/api/unsubscribe?token=${tok("free@example.org")}`, { method: "POST" }));
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
        sql`insert into subscribers (email, status, confirmed_at, premium_waitlist, billing_status, unsubscribe_token)
            values (${email}, ${status}, ${status === "confirmed" ? sql`now() - interval '40 days'` : null}, true, ${billing}, ${`unsub-${email}`})`;
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
      expect(m.subject).toBe("Postbird daily alerts are open");
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

    it("paying through the second checkout sends one confirmation email; the welcome follows confirmation", async () => {
      const first = await billing.startCheckout({ email: "twice@example.org", plan: "monthly", search: "q=nurse" });
      // The first checkout was closed and is now over 30 minutes old: a second one is prepared.
      await sql`update paddle_checkouts set created_at = now() - interval '31 minutes' where ref = ${(first as { ref: string }).ref}`;
      const second = await billing.startCheckout({ email: "twice@example.org", plan: "quarterly", search: "q=nurse" });
      const ref2 = (second as { ref: string }).ref;
      expect(ref2).not.toBe((first as { ref: string }).ref);
      const checkouts = await sql`select new_subscriber from paddle_checkouts c join subscribers s on s.id = c.subscriber_id where s.email = 'twice@example.org' order by c.created_at`;
      expect(checkouts.map((c: { new_subscriber: boolean }) => c.new_subscriber)).toEqual([true, true]);

      const subId = "sub_01hv8x29kz0t586xy6zn1a65aa";
      const res = await postEvent(subEvent("subscription.created", { id: subId, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kc1", custom_data: { ref: ref2 } }));
      expect(await res.text()).toBe("applied");
      await settle();
      const [s] = await sql`select id::int as id, status, billing_status, confirmed_at, confirm_token, welcome_sent_at, manage_token from subscribers where email = 'twice@example.org'`;
      expect(s).toMatchObject({ status: "pending", billing_status: "trialing", confirmed_at: null, welcome_sent_at: null });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "twice@example.org", key: `paid-confirm:${s.id}:${subId}` });
      expect(await billing.checkoutAccountToken(ref2)).toEqual({ linked: true, manageToken: null });

      // A confirmation email that failed to send is retried by the daily job (these rows are covered too).
      await notices.confirmationNotSent(s.id);
      sent.length = 0;
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent[0]).toMatchObject({ to: "twice@example.org", key: `paid-confirm:${s.id}:${subId}` });

      expect((await subscribers.confirmSubscriber(s.confirm_token)).ok).toBe(true);
      sent.length = 0;
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent[0]).toMatchObject({ to: "twice@example.org", key: `welcome:${s.id}:${subId}` });
      expect(sent[0].text).toContain(`/account?t=${s.manage_token}`);
    });

    it("an address its owner touched in between (a sign-up) is not confirmed by paying", async () => {
      await billing.startCheckout({ email: "touched@example.org", plan: "monthly", search: null });
      await sql`update paddle_checkouts c set created_at = now() - interval '31 minutes' from subscribers s where s.id = c.subscriber_id and s.email = 'touched@example.org'`;
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
      const staleSub = "sub_01hv8x29kz0t586xy6zn1a66aa";
      const stale = await claimed("lease-welcome@example.org", { paddle_subscription_id: staleSub, welcome_sent_at: ago(45), welcome_claimed_at: ago(45) });
      const fresh = await claimed("lease-fresh@example.org", { paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a66ab", welcome_sent_at: ago(5), welcome_claimed_at: ago(5) });
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => [m.to, m.key])).toEqual([["lease-welcome@example.org", `welcome:${stale}:${staleSub}`]]);
      const [s] = await sql`select welcome_sent_at, welcome_claimed_at from subscribers where id = ${stale}`;
      expect(s.welcome_sent_at).not.toBeNull();
      expect(s.welcome_claimed_at).toBeNull();
      expect(await notices.runWelcomeRetries()).toEqual({ sent: 0, failed: 0 });
      expect((await sql`select welcome_claimed_at from subscribers where id = ${fresh}`)[0].welcome_claimed_at).not.toBeNull();
    });

    it("a failed send gives the claim back; the next run sends it", async () => {
      const id = await claimed("lease-fail@example.org", { paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a66ac", welcome_sent_at: null });
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

  describe("checkout data the browser could change", () => {
    const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
    const postEvent = async (event: ReturnType<typeof subEvent>) => {
      const { POST } = await import("@/app/api/paddle/webhook/route");
      const body = JSON.stringify(event);
      const ts = Math.floor(Date.now() / 1000);
      return POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
    };

    it("a trialing subscription for a checkout that allowed no trial is canceled in Paddle; alerts stay off, no welcome", async () => {
      // A returning customer's reference (trial_allowed false) used with the catalog price, which has the trial.
      const [r] = await sql`
        insert into subscribers (email, status, billing_status, paddle_subscription_id, canceled_at, unsubscribe_token)
        values ('no-second@example.org', 'confirmed', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a67aa', now() - interval '3 days', ${tok("no-second@example.org")})
        returning id::int as id`;
      await sql`insert into paddle_checkouts (ref, subscriber_id, plan, new_subscriber, trial_allowed) values ('ref-no-trial-0123456789ab', ${r.id}, 'monthly', true, false)`;
      CUSTOMERS.ctm_01hv6y1jedq4p1n0yqn5ba3kd3 = "no-second@example.org";
      const subId = "sub_01hv8x29kz0t586xy6zn1a67ab";
      const ev = subEvent("subscription.created", { id: subId, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kd3", custom_data: { ref: "ref-no-trial-0123456789ab" } }, at(1));
      expect(await (await postEvent(ev)).text()).toBe("flagged");
      await settle();
      expect(paddleCalls).toContain(`POST /subscriptions/${subId}/cancel`);
      const [s] = await sql`select billing_status, plan, paddle_subscription_id, welcome_sent_at from subscribers where id = ${r.id}`;
      expect(s).toMatchObject({ billing_status: "canceled", plan: "free", paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a67aa", welcome_sent_at: null });
      expect(sent).toHaveLength(0);
      expect((await sql`select count(*)::int as n from events where type = 'trial_started' and props->>'plan' is null`)[0].n).toBe(0);
    });

    it("if Paddle refuses the cancel, alerts stay off, the flag says so, and the next event tries again", async () => {
      const [r] = await sql`
        insert into subscribers (email, status, billing_status, paddle_subscription_id, canceled_at, unsubscribe_token)
        values ('cancel-fails@example.org', 'confirmed', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a68aa', now() - interval '3 days', ${tok("cancel-fails@example.org")})
        returning id::int as id`;
      await sql`insert into paddle_checkouts (ref, subscriber_id, plan, new_subscriber, trial_allowed) values ('ref-cancel-fails-0123456789', ${r.id}, 'monthly', true, false)`;
      const subId = "sub_01hv8x29kz0t586xy6zn1a68ab";
      const ev = (s: number) => subEvent("subscription.updated", { id: subId, customer_id: null, custom_data: { ref: "ref-cancel-fails-0123456789" } }, at(s));
      paddleDown = true;
      expect(await (await postEvent(ev(1))).text()).toBe("flagged");
      await settle();
      const [f] = await sql`select detail from billing_flags where subscription_id = ${subId} and kind = 'trial_blocked'`;
      expect(f.detail).toMatch(/^Cancel in Paddle failed \(Paddle API returned HTTP 500 \(internal_error\)\)\. The daily job tries again/);
      expect((await sql`select billing_status from subscribers where id = ${r.id}`)[0].billing_status).toBe("canceled");
      // Paddle is back: the next event for the still-trialing subscription cancels it.
      paddleDown = false;
      paddleCalls.length = 0;
      expect(await (await postEvent(ev(2))).text()).toBe("flagged");
      await settle();
      expect(paddleCalls).toEqual([`POST /subscriptions/${subId}/cancel`]);
      expect((await sql`select detail from billing_flags where subscription_id = ${subId}`)[0].detail).toMatch(/^Canceled in Paddle at once/);
    });

    it("a Paddle customer whose email isn't the subscriber's address is not linked; alerts stay off; flagged", async () => {
      const start = await billing.startCheckout({ email: "victim@example.org", plan: "monthly", search: null });
      const ref = (start as { ref: string }).ref;
      const subId = "sub_01hv8x29kz0t586xy6zn1a69aa";
      const res = await postEvent(subEvent("subscription.created", { id: subId, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kd1", custom_data: { ref } }, at(1)));
      expect(await res.text()).toBe("flagged");
      await settle();
      const [s] = await sql`select status, billing_status, plan, paddle_customer_id, paddle_subscription_id, welcome_sent_at from subscribers where email = 'victim@example.org'`;
      expect(s).toMatchObject({ status: "pending", billing_status: "none", plan: "free", paddle_customer_id: null, paddle_subscription_id: null, welcome_sent_at: null });
      expect(sent).toHaveLength(0);
      const [f] = await sql`select kind, customer_id from billing_flags where subscription_id = ${subId}`;
      expect(f).toEqual({ kind: "customer_mismatch", customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kd1" });
      // Later events for it are held back without asking Paddle again.
      paddleCalls.length = 0;
      expect((await billing.handlePaddleEvent(subEvent("subscription.updated", { id: subId, customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3kd1", custom_data: { ref } }, at(2)))).outcome).toBe("flagged");
      expect(paddleCalls).toEqual([]);
      expect((await sql`select billing_status from subscribers where email = 'victim@example.org'`)[0].billing_status).toBe("none");
    });

    it("a customer that can't be checked isn't linked; billing checks it before any portal opens", async () => {
      const start = await billing.startCheckout({ email: "unchecked@example.org", plan: "monthly", search: null });
      const subId = "sub_01hv8x29kz0t586xy6zn1a6aaa";
      const customer = "ctm_01hv6y1jedq4p1n0yqn5ba3kd2";
      paddleDown = true;
      expect((await billing.handlePaddleEvent(subEvent("subscription.created", { id: subId, customer_id: customer, custom_data: { ref: (start as { ref: string }).ref } }, at(1)))).outcome).toBe("applied");
      const [s] = await sql`
        select id::int as id, email, billing_status, paddle_customer_id, paddle_customer_verified_at, paddle_subscription_id from subscribers where email = 'unchecked@example.org'`;
      expect(s).toMatchObject({ billing_status: "trialing", paddle_customer_id: null, paddle_subscription_id: subId });
      expect((await sql`select kind, resolved_at from billing_flags where subscription_id = ${subId}`)[0]).toEqual({ kind: "customer_unverified", resolved_at: null });
      // Still down: no customer to open billing for.
      expect(await billing.verifiedCustomerFor(s)).toBeNull();
      // Paddle answers again: the next event checks and links it, and settles the flag.
      paddleDown = false;
      await billing.handlePaddleEvent(subEvent("subscription.updated", { id: subId, customer_id: customer, custom_data: null }, at(2)));
      const [after] = await sql`select paddle_customer_id, paddle_customer_verified_at from subscribers where id = ${s.id}`;
      expect(after.paddle_customer_id).toBe(customer);
      expect(after.paddle_customer_verified_at).not.toBeNull();
      expect((await sql`select resolved_at from billing_flags where subscription_id = ${subId}`)[0].resolved_at).not.toBeNull();
    });

    it("a customer id stored before the check existed is checked when billing opens, and unlinked if it isn't the address's", async () => {
      const [ok] = await sql`
        insert into subscribers (email, status, billing_status, paddle_customer_id, paddle_subscription_id, unsubscribe_token)
        values ('old-link@example.org', 'confirmed', 'active', 'ctm_01hv6y1jedq4p1n0yqn5ba3kd4', 'sub_01hv8x29kz0t586xy6zn1a6baa', ${tok("old-link@example.org")})
        returning id::int as id, email, paddle_customer_id, paddle_customer_verified_at, paddle_subscription_id`;
      CUSTOMERS.ctm_01hv6y1jedq4p1n0yqn5ba3kd4 = "OLD-LINK@example.org";
      expect(await billing.verifiedCustomerFor(ok)).toBe("ctm_01hv6y1jedq4p1n0yqn5ba3kd4");
      expect((await sql`select paddle_customer_verified_at from subscribers where id = ${ok.id}`)[0].paddle_customer_verified_at).not.toBeNull();

      const [bad] = await sql`
        insert into subscribers (email, status, billing_status, paddle_customer_id, paddle_subscription_id, unsubscribe_token)
        values ('wrong-link@example.org', 'confirmed', 'active', 'ctm_01hv6y1jedq4p1n0yqn5ba3kd1', 'sub_01hv8x29kz0t586xy6zn1a6bbb', ${tok("wrong-link@example.org")})
        returning id::int as id, email, paddle_customer_id, paddle_customer_verified_at, paddle_subscription_id`;
      expect(await billing.verifiedCustomerFor(bad)).toBeNull();
      expect((await sql`select paddle_customer_id from subscribers where id = ${bad.id}`)[0].paddle_customer_id).toBeNull();
      expect((await sql`select kind from billing_flags where subscription_id = 'sub_01hv8x29kz0t586xy6zn1a6bbb'`)[0].kind).toBe("customer_mismatch");
      // No customer id ever goes into a URL other than as the id itself; no email in any Paddle URL.
      expect(paddleCalls.some((c) => c.includes("@") || c.includes("%40"))).toBe(false);
    });
  });

  describe("account link rotation", () => {
    it("the link is replaced only once the email went out: a failed send keeps the old link working", async () => {
      await sql`delete from rate_limits`;
      const [r] = await sql`insert into subscribers (email, status, unsubscribe_token) values ('keep-link@example.org', 'confirmed', ${tok("keep-link@example.org")}) returning id::int as id, manage_token`;
      const stub = globalThis.fetch;
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ name: "validation_error", message: "nope" }), { status: 422 }));
      try {
        expect(await account.sendAccountLink("keep-link@example.org")).toBe(false);
      } finally {
        vi.stubGlobal("fetch", stub);
      }
      expect((await sql`select manage_token from subscribers where id = ${r.id}`)[0].manage_token).toBe(r.manage_token);
      // Sent: replaced, and the email carries the new one.
      expect(await account.sendAccountLink("keep-link@example.org", "cancel")).toBe(true);
      const [{ manage_token: fresh }] = await sql`select manage_token from subscribers where id = ${r.id}`;
      expect(fresh).not.toBe(r.manage_token);
      const m = sent.find((x) => x.to === "keep-link@example.org")!;
      expect(m.subject).toBe("Your link to cancel your Postbird plan");
      expect(m.text).toContain(`/account?t=${fresh}`);
    });
  });

  describe("one free trial per email address, after deletion", () => {
    it("deleting an address that had a plan leaves a one-way marker for 24 months; others leave none", async () => {
      const markers = await import("@/lib/billing/trial-markers");
      await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, canceled_at, unsubscribe_token)
        values ('had-plan-gone@example.org', 'confirmed', now() - interval '90 days', 'canceled', now() - interval '40 days', ${tok("had-plan-gone@example.org")}),
               ('never-paid-gone@example.org', 'pending', null, 'none', null, ${tok("never-paid-gone@example.org")}),
               ('never-confirmed-gone@example.org', 'pending', null, 'canceled', now() - interval '40 days', ${tok("never-confirmed-gone@example.org")})`;
      await sql`update subscribers set created_at = now() - interval '40 days' where email in ('never-paid-gone@example.org', 'never-confirmed-gone@example.org')`;
      await sql`insert into trial_markers (hash, expires_at) values ('expired-marker', now() - interval '1 day')`;
      await subscribers.purgeStaleSubscribers();
      expect(await sql`select 1 from subscribers where email in ('had-plan-gone@example.org', 'never-paid-gone@example.org', 'never-confirmed-gone@example.org')`).toHaveLength(0);
      expect(await markers.hasTrialMarker("had-plan-gone@example.org")).toBe(true);
      // Another form of the same address is marked too (one trial per person).
      expect(await markers.hasTrialMarker("Had-Plan-Gone+again@example.org")).toBe(true);
      expect(await markers.hasTrialMarker("never-paid-gone@example.org")).toBe(false);
      // A plan at an address that was never confirmed leaves no marker.
      expect(await markers.hasTrialMarker("never-confirmed-gone@example.org")).toBe(false);
      const [m] = await sql`select hash, expires_at from trial_markers where hash = ${markers.trialMarker("had-plan-gone@example.org")!}`;
      expect(m.hash).not.toContain("had-plan-gone");
      const months = (new Date(m.expires_at).getTime() - Date.now()) / (30.44 * 86_400_000);
      expect(months).toBeGreaterThan(23.5);
      expect(months).toBeLessThan(24.5);
      // Expired markers go with the clean-up.
      expect(await sql`select 1 from trial_markers where hash = 'expired-marker'`).toHaveLength(0);

      // The address comes back: no trial checkout, the same "check your inbox" as any customer,
      // and a trialing subscription for it would be canceled.
      const back = await billing.startCheckout({ email: "had-plan-gone@example.org", plan: "monthly", search: "q=data" });
      expect(back).toMatchObject({ ok: true, inbox: true, live: false });
      expect(await sql`select 1 from paddle_checkouts c join subscribers s on s.id = c.subscriber_id where s.email = 'had-plan-gone@example.org'`).toHaveLength(0);
    });
  });

  describe("NUL bytes and other control characters", () => {
    it("never reach the database from the job search, organization pages or tokens", async () => {
      const jobs = await import("@/lib/jobs");
      const f = jobs.parseFilters({ q: "data\u0000analyst", org: "uni\u0000cef", sort: "newest\u0000" });
      expect(f.q).toBe("data analyst");
      expect(f.org).toBeUndefined();
      expect(f.sort).toBe("newest");
      await expect(jobs.searchJobs(jobs.parseFilters({ q: "\u0000" }))).resolves.toBeTruthy();
      expect(await jobs.getOrganization("a\u0000b")).toBeNull();
      expect(await subscribers.findByUnsubscribeToken("unsub-free\u0000xxxxxxxxxxxxxx")).toBeNull();
      expect(await subscribers.findByConfirmToken(["a".repeat(32), "b".repeat(32)])).toBeNull();
      expect(await subscribers.confirmSubscriber("x\u0000".repeat(12))).toEqual({ ok: false });
      expect(await account.findByManageToken("\u0000")).toBeNull();
      expect(await billing.checkoutAccountToken("ref\u0000" + "x".repeat(20))).toEqual({ linked: false, manageToken: null });
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

    it("never serves, keeps or fetches a Red Cross or Red Crescent emblem (by name or website)", async () => {
      const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000040000000400806000000", "hex");
      await sql`insert into organizations (slug, name, short_name, org_type, website, logo, logo_type) values
        ('icrc-x', 'International Committee of the Red Cross', 'ICRC', 'International organization', 'icrc.org', ${png}, 'image/png'),
        ('ns-x', 'Croix-Rouge française', null, 'NGO', null, ${png}, 'image/png'),
        ('rc-site', 'Volunteer programme', null, 'NGO', 'www.redcross.org.uk', ${png}, 'image/png'),
        ('ngo-y', 'NGO Y', null, 'NGO', 'ngo-y.example', ${png}, 'image/png')`;
      const { GET } = await import("@/app/api/org-logo/[slug]/route");
      const get = (slug: string) => GET(new Request(`http://localhost/api/org-logo/${slug}`), { params: Promise.resolve({ slug }) });
      for (const slug of ["icrc-x", "ns-x", "rc-site"]) expect([slug, (await get(slug)).status]).toEqual([slug, 404]);
      expect((await get("ngo-y")).status).toBe(200);
      const jobs = await import("@/lib/jobs");
      expect((await jobs.getOrganization("icrc-x"))?.logo).toBeNull();
      expect((await jobs.getOrganization("ngo-y"))?.logo).toBe("ngo-y");
      const logos = await import("@/lib/feeds/logos");
      expect(await logos.clearProtectedLogos()).toBe(3);
      const rows = await sql`select slug from organizations where logo is not null and slug in ('icrc-x', 'ns-x', 'rc-site', 'ngo-y')`;
      expect(rows.map((r: { slug: string }) => r.slug)).toEqual(["ngo-y"]);
      // Never picked for fetching either (the icon refresh checks the same rule before fetching).
      await sql`update organizations set logo_checked_at = null where slug in ('icrc-x', 'ns-x', 'rc-site')`;
      const fetched: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (u: string | URL) => { fetched.push(String(u)); return new Response(null, { status: 404 }); }) as typeof fetch;
      try {
        await logos.refreshOrgLogos(() => 60_000);
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(fetched.filter((u) => /icrc|redcross/.test(u))).toEqual([]);
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
