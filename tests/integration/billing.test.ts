/**
 * Paid alerts against a real database: Paddle webhook → subscriber linking,
 * idempotency and ordering, and alert delivery without double sends.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables
 * are emptied). Email sending (Resend) is replaced by a stub.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "pdl_ntfset_test_secret_0123456789";

const SUB_ID = "sub_01hv8x29kz0t586xy6zn1a62ny";
const SUB_ID_2 = "sub_01hv8x29kz0t586xy6zn1a62nz";
const CUSTOMER = "ctm_01hv6y1jedq4p1n0yqn5ba3ky4";

type Sent = { to: string; subject: string; text: string; headers?: Record<string, string> };

describe.skipIf(!TEST_DB)("paid alerts (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let billing: typeof import("@/lib/billing/subscriptions");
  let digest: typeof import("@/lib/digest");
  let paddle: typeof import("@/lib/billing/paddle");
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
    delete process.env.PADDLE_API_KEY;

    // Resend stub: records every message instead of sending it.
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://api.resend.com/")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], subject: m.subject, text: m.text, headers: m.headers });
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
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
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
});
