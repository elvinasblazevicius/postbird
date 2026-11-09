/**
 * Billing safety against a real database: trials at addresses nobody
 * confirmed are canceled before they turn into a payment (and get the
 * confirmation email again on days 3 and 10, not the trial reminder), a second
 * running subscription for one address is canceled and never applied, failed
 * Paddle cancels and unchecked customers are retried by the daily job, the SQL
 * had_plan() agrees with hadTrialBefore(), every table has row level security,
 * and a paid alert re-sent after a lost write keeps its idempotency key.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables
 * are emptied). Resend and Paddle's API are replaced by stubs.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => { afterTasks.push(Promise.resolve().then(task)); },
}));
const settle = async () => { await Promise.all(afterTasks.splice(0)); };

const TEST_DB = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "pdl_ntfset_test_secret_0123456789";
const API_KEY = "pdl_sdbx_apikey_test_0123456789";

/** Paddle customers the stub knows (GET /customers/{id}). */
const CUSTOMERS: Record<string, string> = {
  ctm_01hv6y1jedq4p1n0yqn5ba3s01: "two-tabs@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3s02: "two-links@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3s03: "recheck-ok@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3s04: "someone-else@example.org",
};

type Sent = { to: string; subject: string; text: string; key?: string };

describe.skipIf(!TEST_DB)("billing safety (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let billing: typeof import("@/lib/billing/subscriptions");
  let links: typeof import("@/lib/billing/checkout-links");
  let paddle: typeof import("@/lib/billing/paddle");
  let notices: typeof import("@/lib/billing/notices");
  let digest: typeof import("@/lib/digest");
  const sent: Sent[] = [];
  const paddleCalls: string[] = [];
  let paddleDown = false;
  /** Subscriptions Paddle reports as already canceled (GET), whose cancel it refuses. */
  const canceledInPaddle = new Set<string>();
  let eventSeq = 0;

  const subEvent = (type: string, data: Record<string, unknown>, occurredAt = new Date().toISOString()) => ({
    event_id: `evt_safety_${++eventSeq}`, event_type: type, occurred_at: occurredAt, notification_id: `ntf_safety_${eventSeq}`, data,
  });
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const trialing = (id: string, customer: string, ref: string | null, endsInDays = 14) => ({
    id, status: "trialing", customer_id: customer, custom_data: ref ? { ref } : null,
    billing_cycle: { interval: "month", frequency: 1 },
    current_billing_period: { starts_at: inDays(endsInDays - 14), ends_at: inDays(endsInDays) }, next_billed_at: inDays(endsInDays),
    items: [{ price: { id: "pri_test" }, trial_dates: { starts_at: inDays(endsInDays - 14), ends_at: inDays(endsInDays) } }],
  });
  const postEvent = async (event: ReturnType<typeof subEvent>) => {
    const { POST } = await import("@/app/api/paddle/webhook/route");
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const res = await POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
    return res.text();
  };
  const tok = (email: string) => `unsub-${email.replace(/[^\w-]/g, "-")}`.padEnd(24, "x");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PADDLE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.PADDLE_API_KEY = API_KEY;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.ANALYTICS_SALT = "test-analytics-salt-0123456789";
    delete process.env.NEXT_PUBLIC_PADDLE_ENV;

    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.startsWith("https://api.resend.com/")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        const key = (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"];
        for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], subject: m.subject, text: m.text, key });
        return Response.json({ id: "stub" });
      }
      if (u.startsWith("https://sandbox-api.paddle.com/")) {
        paddleCalls.push(`${method} ${u.replace("https://sandbox-api.paddle.com", "")}`);
        if (paddleDown) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
        const ctm = u.match(/\/customers\/(ctm_\w+)$/)?.[1];
        if (method === "GET" && ctm && CUSTOMERS[ctm]) return Response.json({ data: { id: ctm, email: CUSTOMERS[ctm] } });
        const cancel = u.match(/\/subscriptions\/(sub_\w+)\/cancel$/)?.[1];
        if (method === "POST" && cancel) {
          if (canceledInPaddle.has(cancel)) return Response.json({ error: { code: "subscription_locked_canceled" } }, { status: 400 });
          return Response.json({ data: { id: cancel, status: "canceled" } });
        }
        const sub = u.match(/\/subscriptions\/(sub_\w+)$/)?.[1];
        if (method === "GET" && sub && canceledInPaddle.has(sub)) return Response.json({ data: { id: sub, status: "canceled", customer_id: null, custom_data: null } });
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });

    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    }
    await sql.unsafe(`truncate subscribers, saved_searches, paddle_checkouts, paddle_events, events, digests, jobs, job_sources, organizations,
      rate_limits, billing_flags, checkout_links, trial_markers, alert_closing_sent restart identity cascade`);
    billing = await import("@/lib/billing/subscriptions");
    links = await import("@/lib/billing/checkout-links");
    paddle = await import("@/lib/billing/paddle");
    notices = await import("@/lib/billing/notices");
    digest = await import("@/lib/digest");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    paddleCalls.length = 0;
    afterTasks.length = 0;
    paddleDown = false;
    canceledInPaddle.clear();
    await sql`update locks set locked_until = null, holder = null`;
  });

  describe("schema", () => {
    it("every table has row level security on (migration 015 adds alert_closing_sent)", async () => {
      const off = await sql`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by c.relname`;
      expect(off.map((r: { relname: string }) => r.relname)).toEqual([]);
      expect((await sql`select relrowsecurity from pg_class where relname = 'alert_closing_sent'`)[0].relrowsecurity).toBe(true);
    });

    it("had_plan() in SQL agrees with hadTrialBefore() on every combination of the plan fields", async () => {
      const cases: { confirmed: boolean; sub: boolean; status: string; trial: boolean; canceled: boolean }[] = [];
      for (const confirmed of [false, true]) for (const sub of [false, true]) for (const status of ["none", "trialing", "active", "past_due", "paused", "canceled"])
        for (const trial of [false, true]) for (const canceled of [false, true]) cases.push({ confirmed, sub, status, trial, canceled });
      const rows = await sql`
        insert into subscribers (email, status, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unsubscribe_token)
        select 'hadplan-' || i || '@example.org', 'pending', case when c then now() end, case when s then 'sub_hadplan_' || i end, b,
               case when t then now() end, case when x then now() end, 'unsub-hadplan-' || lpad(i::text, 6, '0') || '-xxxxxxxx'
        from unnest(${cases.map((_, i) => i)}::int[], ${cases.map((c) => c.confirmed)}::bool[], ${cases.map((c) => c.sub)}::bool[],
                    ${cases.map((c) => c.status)}::text[], ${cases.map((c) => c.trial)}::bool[], ${cases.map((c) => c.canceled)}::bool[]) as u(i, c, s, b, t, x)
        returning email, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, had_plan(subscribers) as sql_had_plan`;
      expect(rows).toHaveLength(cases.length);
      for (const r of rows) expect([r.email, r.sql_had_plan]).toEqual([r.email, billing.hadTrialBefore(r)]);
      // Both answers occur, so the comparison means something.
      expect(new Set(rows.map((r: { sql_had_plan: boolean }) => r.sql_had_plan))).toEqual(new Set([true, false]));
      await sql`delete from subscribers where email like 'hadplan-%'`;
    });
  });

  describe("one running subscription per address", () => {
    it("two public checkouts: the second isn't prepared while the first is open; a second subscription is canceled, not applied", async () => {
      const first = await billing.startCheckout({ email: "two-tabs@example.org", plan: "monthly", search: null });
      expect(first).toMatchObject({ ok: true, trial: true });
      // A second tab, straight away: refused, with a neutral reply.
      expect(await billing.startCheckout({ email: "two-tabs@example.org", plan: "quarterly", search: null }))
        .toEqual({ ok: false, error: "Your checkout is already open. If you closed it, try again in a few minutes." });
      expect(links.checkoutReply({ ok: false, error: billing.CHECKOUT_ALREADY_OPEN }, "quarterly")).toEqual({ status: "error", message: billing.CHECKOUT_ALREADY_OPEN });
      // 30 minutes later (the first checkout was closed without paying) a new one is prepared.
      await sql`update paddle_checkouts set created_at = now() - interval '31 minutes' where ref = ${(first as { ref: string }).ref}`;
      const second = await billing.startCheckout({ email: "two-tabs@example.org", plan: "quarterly", search: null });
      expect(second).toMatchObject({ ok: true, trial: true });

      // Both tabs were paid after all: the first subscription is applied, the second canceled at once.
      const subA = "sub_01hv8x29kz0t586xy6zn1a7s01", subB = "sub_01hv8x29kz0t586xy6zn1a7s02";
      const customer = "ctm_01hv6y1jedq4p1n0yqn5ba3s01";
      expect(await postEvent(subEvent("subscription.created", trialing(subA, customer, (first as { ref: string }).ref)))).toBe("applied");
      await settle();
      sent.length = 0;
      paddleCalls.length = 0;
      expect(await postEvent(subEvent("subscription.created", trialing(subB, customer, (second as { ref: string }).ref)))).toBe("flagged");
      await settle();
      expect(paddleCalls).toEqual([`POST /subscriptions/${subB}/cancel`]);
      expect(sent).toHaveLength(0);
      const [s] = await sql`select paddle_subscription_id, billing_status from subscribers where email = 'two-tabs@example.org'`;
      expect(s).toEqual({ paddle_subscription_id: subA, billing_status: "trialing" });
      const [f] = await sql`select kind, detail, cancel_done_at from billing_flags where subscription_id = ${subB}`;
      expect(f.kind).toBe("duplicate_subscription");
      expect(f.detail).toMatch(/^Canceled in Paddle at once; it was never applied/);
      expect(f.cancel_done_at).not.toBeNull();
      // Paddle's own cancel event for it changes nothing, and asks for no second cancel.
      paddleCalls.length = 0;
      expect(await postEvent(subEvent("subscription.canceled", { ...trialing(subB, customer, (second as { ref: string }).ref), status: "canceled", canceled_at: inDays(0) }))).toBe("flagged");
      await settle();
      expect(paddleCalls).toEqual([]);
      expect((await sql`select paddle_subscription_id from subscribers where email = 'two-tabs@example.org'`)[0].paddle_subscription_id).toBe(subA);
    });

    it("two continue links: both checkouts open, the second subscription is canceled and the first stays", async () => {
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, unsubscribe_token) values ('two-links@example.org', 'confirmed', now(), ${tok("two-links@example.org")})
        returning id::int as id`;
      const t1 = await links.createCheckoutLink(r.id, { plan: "monthly", search: null });
      const t2 = await links.createCheckoutLink(r.id, { plan: "monthly", search: null });
      const c1 = await links.continueCheckout(t1, "monthly");
      const c2 = await links.continueCheckout(t2, "monthly");
      expect(c1).toMatchObject({ ok: true, trial: true });
      expect(c2).toMatchObject({ ok: true, trial: true });
      const subA = "sub_01hv8x29kz0t586xy6zn1a7s11", subB = "sub_01hv8x29kz0t586xy6zn1a7s12";
      const customer = "ctm_01hv6y1jedq4p1n0yqn5ba3s02";
      expect(await postEvent(subEvent("subscription.created", trialing(subA, customer, (c1 as { ref: string }).ref)))).toBe("applied");
      await settle();
      paddleCalls.length = 0;
      // The second arrives as active (e.g. a plan without a trial): still a second running subscription.
      expect(await postEvent(subEvent("subscription.created", { ...trialing(subB, customer, (c2 as { ref: string }).ref), status: "active", items: [{ price: { id: "pri_test" } }] }))).toBe("flagged");
      await settle();
      expect(paddleCalls).toEqual([`POST /subscriptions/${subB}/cancel`]);
      const [s] = await sql`select paddle_subscription_id, billing_status, status from subscribers where id = ${r.id}`;
      expect(s).toEqual({ paddle_subscription_id: subA, billing_status: "trialing", status: "confirmed" });
      expect((await sql`select kind from billing_flags where subscription_id = ${subB}`)[0].kind).toBe("duplicate_subscription");
    });
  });

  describe("trials at addresses nobody confirmed", () => {
    /** A trialing subscriber; `confirmed` sets status and confirmed_at, otherwise it waits for confirmation. */
    async function trial(email: string, o: { endsInDays: number; confirmed?: boolean; sub: string; confirmSentDaysAgo?: number }) {
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, confirm_token, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at,
                                 confirm_sent_at, welcome_sent_at, unsubscribe_token)
        values (${email}, ${o.confirmed ? "confirmed" : "pending"}, ${o.confirmed ? sql`now() - interval '10 days'` : null},
                ${o.confirmed ? null : `confirm-${email.replace(/[^\w]/g, "")}`.padEnd(24, "x")}, 'trialing', 'premium', 'month', ${o.sub},
                now() + make_interval(hours => ${Math.round(o.endsInDays * 24)}),
                now() - make_interval(hours => ${Math.round((o.confirmSentDaysAgo ?? 14 - o.endsInDays) * 24)}), ${o.confirmed ? sql`now()` : null}, ${tok(email)})
        returning id::int as id, manage_token`;
      return r as { id: number; manage_token: string };
    }

    it("is canceled in Paddle 2 days before it ends, flagged, with no email and no trial reminder; a confirmed one is left alone", async () => {
      const ending = await trial("never-confirmed@example.org", { endsInDays: 1.5, sub: "sub_01hv8x29kz0t586xy6zn1a7u01" });
      await trial("confirmed-trial@example.org", { endsInDays: 1.5, confirmed: true, sub: "sub_01hv8x29kz0t586xy6zn1a7u02" });
      await trial("still-time@example.org", { endsInDays: 5, sub: "sub_01hv8x29kz0t586xy6zn1a7u03" });

      const res = await billing.runBillingSafety();
      expect(res).toEqual({ unconfirmed: { canceled: 1, failed: 0 }, cancelRetries: { canceled: 0, failed: 0 }, customers: { verified: 0, mismatch: 0, unverified: 0 } });
      expect(paddleCalls).toEqual(["POST /subscriptions/sub_01hv8x29kz0t586xy6zn1a7u01/cancel"]);
      const [f] = await sql`select kind, subscriber_id::int as subscriber_id, detail, cancel_done_at, resolved_at from billing_flags where subscription_id = 'sub_01hv8x29kz0t586xy6zn1a7u01'`;
      expect(f).toMatchObject({ kind: "trial_unconfirmed", subscriber_id: ending.id, resolved_at: null });
      expect(f.detail).toMatch(/^Canceled in Paddle at once, so nothing is charged/);
      expect(f.cancel_done_at).not.toBeNull();
      expect(sent).toHaveLength(0);

      // The trial reminder only goes to the confirmed trial; the canceled one gets no confirmation email either.
      expect(await notices.runTrialReminders()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => m.to)).toEqual(["confirmed-trial@example.org"]);
      sent.length = 0;
      await sql`update subscribers set confirm_sent_at = now() - interval '20 days' where email = 'never-confirmed@example.org'`;
      await notices.runConfirmationRetries();
      expect(sent.filter((m) => m.to === "never-confirmed@example.org")).toHaveLength(0);

      // The next day's run doesn't cancel it again (Paddle's cancel event may not have arrived yet).
      paddleCalls.length = 0;
      expect((await billing.runBillingSafety() as { unconfirmed: { canceled: number } }).unconfirmed.canceled).toBe(0);
      expect(paddleCalls).toEqual([]);
      // Paddle's cancel event then ends the plan as usual.
      expect(await postEvent(subEvent("subscription.canceled", { ...trialing("sub_01hv8x29kz0t586xy6zn1a7u01", "", null, 1.5), status: "canceled", canceled_at: inDays(0) }))).toBe("applied");
      expect((await sql`select billing_status from subscribers where id = ${ending.id}`)[0].billing_status).toBe("canceled");
      await sql`delete from subscribers where email in ('never-confirmed@example.org', 'confirmed-trial@example.org', 'still-time@example.org')`;
    });

    it("if Paddle can't be reached, the flag says so and the next daily run cancels it", async () => {
      await trial("cancel-later@example.org", { endsInDays: 1, sub: "sub_01hv8x29kz0t586xy6zn1a7u11" });
      paddleDown = true;
      expect((await billing.runBillingSafety() as { unconfirmed: unknown }).unconfirmed).toEqual({ canceled: 0, failed: 1 });
      const [f] = await sql`select detail, cancel_done_at from billing_flags where subscription_id = 'sub_01hv8x29kz0t586xy6zn1a7u11'`;
      expect(f.detail).toMatch(/^Cancel in Paddle failed .*The daily job tries again/);
      expect(f.cancel_done_at).toBeNull();
      paddleDown = false;
      paddleCalls.length = 0;
      expect((await billing.runBillingSafety() as { unconfirmed: unknown }).unconfirmed).toEqual({ canceled: 1, failed: 0 });
      expect(paddleCalls).toEqual(["POST /subscriptions/sub_01hv8x29kz0t586xy6zn1a7u11/cancel"]);
      await sql`delete from subscribers where email = 'cancel-later@example.org'`;
    });

    it("gets the confirmation email again on day 3 and day 10 of the trial, once each, with its own key", async () => {
      // Day 3.5 of the trial; the first email went out when the trial started.
      const r = await trial("resend@example.org", { endsInDays: 10.5, sub: "sub_01hv8x29kz0t586xy6zn1a7u21", confirmSentDaysAgo: 3.5 });
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent[0]).toMatchObject({ to: "resend@example.org", key: `paid-confirm:${r.id}:sub_01hv8x29kz0t586xy6zn1a7u21:day3` });
      expect(sent[0].subject).toMatch(/^Confirm your email/);
      expect(sent[0].text).toContain("If you don't confirm by");
      expect(sent[0].text).toContain(`/account?t=${r.manage_token}`);
      sent.length = 0;
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 0, failed: 0 });

      // Day 10.5: the last one before the trial is canceled.
      await sql`update subscribers set trial_ends_at = now() + interval '3.5 days', confirm_sent_at = now() - interval '7 days' where id = ${r.id}`;
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 1, failed: 0 });
      expect(sent[0].key).toBe(`paid-confirm:${r.id}:sub_01hv8x29kz0t586xy6zn1a7u21:day10`);
      sent.length = 0;
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 0, failed: 0 });
      // No trial reminder for it, even within 3 days of the end.
      await sql`update subscribers set trial_ends_at = now() + interval '2.5 days' where id = ${r.id}`;
      expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
      await sql`delete from subscribers where id = ${r.id}`;
    });
  });

  describe("daily retries", () => {
    it("re-runs cancels that failed when the webhook asked, and counts one Paddle already canceled as done", async () => {
      const failedSub = "sub_01hv8x29kz0t586xy6zn1a7v01", goneSub = "sub_01hv8x29kz0t586xy6zn1a7v02", doneSub = "sub_01hv8x29kz0t586xy6zn1a7v03";
      await sql`
        insert into billing_flags (subscription_id, kind, detail, cancel_done_at) values
          (${failedSub}, 'trial_blocked', 'Cancel in Paddle failed (timeout).', null),
          (${goneSub}, 'duplicate_subscription', 'Cancel in Paddle failed (timeout).', null),
          (${doneSub}, 'trial_blocked', 'Canceled in Paddle at once, so nothing is charged. Alerts stayed off; no welcome was sent.', now())`;
      canceledInPaddle.add(goneSub);
      const res = await billing.runBillingSafety();
      expect(res).toMatchObject({ cancelRetries: { canceled: 2, failed: 0 } });
      expect(paddleCalls.sort()).toEqual([`GET /subscriptions/${goneSub}`, `POST /subscriptions/${failedSub}/cancel`, `POST /subscriptions/${goneSub}/cancel`].sort());
      const flags = await sql`select subscription_id, cancel_done_at is not null as done, detail from billing_flags where subscription_id in (${failedSub}, ${goneSub}) order by subscription_id`;
      expect(flags.map((f: { done: boolean }) => f.done)).toEqual([true, true]);
      paddleCalls.length = 0;
      expect(await billing.runBillingSafety()).toMatchObject({ cancelRetries: { canceled: 0, failed: 0 } });
      expect(paddleCalls).toEqual([]);
    });

    it("re-checks Paddle customers that couldn't be checked: a match is linked, a mismatch is flagged", async () => {
      const ok = "sub_01hv8x29kz0t586xy6zn1a7w01", bad = "sub_01hv8x29kz0t586xy6zn1a7w02";
      const rows = await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, paddle_subscription_id, unsubscribe_token) values
          ('recheck-ok@example.org', 'confirmed', now(), 'active', ${ok}, ${tok("recheck-ok@example.org")}),
          ('recheck-bad@example.org', 'confirmed', now(), 'active', ${bad}, ${tok("recheck-bad@example.org")})
        returning id::int as id, email`;
      const id = (e: string) => rows.find((r: { email: string }) => r.email === e).id;
      await sql`
        insert into billing_flags (subscription_id, kind, subscriber_id, customer_id, detail) values
          (${ok}, 'customer_unverified', ${id("recheck-ok@example.org")}, 'ctm_01hv6y1jedq4p1n0yqn5ba3s03', 'not checked'),
          (${bad}, 'customer_unverified', ${id("recheck-bad@example.org")}, 'ctm_01hv6y1jedq4p1n0yqn5ba3s04', 'not checked')`;
      expect(await billing.runBillingSafety()).toMatchObject({ customers: { verified: 1, mismatch: 1, unverified: 0 } });
      const [linked] = await sql`select paddle_customer_id, paddle_customer_verified_at from subscribers where email = 'recheck-ok@example.org'`;
      expect(linked.paddle_customer_id).toBe("ctm_01hv6y1jedq4p1n0yqn5ba3s03");
      expect(linked.paddle_customer_verified_at).not.toBeNull();
      expect((await sql`select paddle_customer_id from subscribers where email = 'recheck-bad@example.org'`)[0].paddle_customer_id).toBeNull();
      const open = await sql`select subscription_id, kind from billing_flags where subscription_id in (${ok}, ${bad}) and resolved_at is null order by subscription_id`;
      expect(open).toEqual([{ subscription_id: bad, kind: "customer_mismatch" }]);
    });
  });

  describe("paid alerts", () => {
    it("an alert whose sent-record was lost is sent again under the same key; a later one gets a new key", async () => {
      await sql`delete from subscribers`;
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, plan, frequency, unsubscribe_token)
        values ('alert-key@example.org', 'confirmed', now(), 'active', 'premium', 'daily', ${tok("alert-key@example.org")}) returning id::int as id`;
      await sql`insert into saved_searches (subscriber_id, search, label) values (${r.id}, '', 'All new vacancies')`;
      await sql`
        insert into jobs (slug, title, apply_url, apply_host, url_hash, status, first_seen_at, published_at)
        values ('alert-key-job', 'Alert key officer', 'https://example.org/alert-key', 'example.org', 'hash-alert-key', 'active', now() - interval '1 hour', now() - interval '1 hour')`;
      const one = (await digest.runAlerts()).sent;
      expect(one).toBe(1);
      const first = sent.find((m) => m.to === "alert-key@example.org")!;
      expect(first.key).toMatch(/^alerts:[0-9a-f]{40}$/); // the batch key, built from the message keys
      const [{ last_sent_at }] = await sql`select last_sent_at from saved_searches where subscriber_id = ${r.id}`;
      expect(last_sent_at).not.toBeNull();
      // The same windows give the same message key; a new window a new one.
      const searches = await sql`select id::int as id from saved_searches where subscriber_id = ${r.id}`;
      expect(digest.alertKey(r.id, [{ id: searches[0].id, last_sent_at: null }])).toBe(digest.alertKey(r.id, [{ id: searches[0].id, last_sent_at: null }]));
      expect(digest.alertKey(r.id, [{ id: searches[0].id, last_sent_at }])).not.toBe(digest.alertKey(r.id, [{ id: searches[0].id, last_sent_at: null }]));

      // The run stopped after Resend accepted it, before the record was written: the next run's
      // batch carries the same message key, so Resend sends nothing twice.
      await sql`update saved_searches set last_sent_at = null where subscriber_id = ${r.id}`;
      await sql`update locks set locked_until = null, holder = null`;
      sent.length = 0;
      await digest.runAlerts();
      expect(sent.find((m) => m.to === "alert-key@example.org")?.key).toBe(first.key);
    });
  });
});
