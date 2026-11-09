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
// The admin's "Mark dealt with" action, called directly: signed in, no redirect or cache to refresh.
vi.mock("@/app/admin/guard", () => ({ requireAdmin: async () => {} }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), redirect: () => {} }));
vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: () => {} }));

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
      // unc: the trial canceled for want of confirmation (unconfirmed_trial_sub): none, this row's subscription, or another one.
      const cases: { confirmed: boolean; sub: boolean; status: string; trial: boolean; canceled: boolean; unc: string }[] = [];
      for (const confirmed of [false, true]) for (const sub of [false, true]) for (const status of ["none", "trialing", "active", "past_due", "paused", "canceled"])
        for (const trial of [false, true]) for (const canceled of [false, true]) for (const unc of ["none", "same", "other"]) cases.push({ confirmed, sub, status, trial, canceled, unc });
      const rows = await sql`
        insert into subscribers (email, status, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unconfirmed_trial_sub, unsubscribe_token)
        select 'hadplan-' || i || '@example.org', 'pending', case when c then now() end, case when s then 'sub_hadplan_' || i end, b,
               case when t then now() end, case when x then now() end,
               case u when 'same' then 'sub_hadplan_' || i when 'other' then 'sub_hadplan_other' end,
               'unsub-hadplan-' || lpad(i::text, 6, '0') || '-xxxxxxxx'
        from unnest(${cases.map((_, i) => i)}::int[], ${cases.map((c) => c.confirmed)}::bool[], ${cases.map((c) => c.sub)}::bool[],
                    ${cases.map((c) => c.status)}::text[], ${cases.map((c) => c.trial)}::bool[], ${cases.map((c) => c.canceled)}::bool[],
                    ${cases.map((c) => c.unc)}::text[]) as u(i, c, s, b, t, x, u)
        returning email, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unconfirmed_trial_sub, had_plan(subscribers) as sql_had_plan`;
      expect(rows).toHaveLength(cases.length);
      for (const r of rows) expect([r.email, r.sql_had_plan]).toEqual([r.email, billing.hadTrialBefore(r)]);
      // Both answers occur, so the comparison means something.
      expect(new Set(rows.map((r: { sql_had_plan: boolean }) => r.sql_had_plan))).toEqual(new Set([true, false]));
      await sql`delete from subscribers where email like 'hadplan-%'`;
    });

    it("awaiting_confirmation() in SQL agrees with awaitingConfirmation(): only never-confirmed addresses", async () => {
      const cases: { status: string; confirmed: boolean; token: boolean }[] = [];
      for (const status of ["pending", "confirmed", "unsubscribed"]) for (const confirmed of [false, true]) for (const token of [false, true]) cases.push({ status, confirmed, token });
      const rows = await sql`
        insert into subscribers (email, status, confirmed_at, confirm_token, unsubscribe_token)
        select 'awaiting-' || i || '@example.org', st, case when c then now() end, case when t then 'confirm-awaiting-' || lpad(i::text, 8, '0') end,
               'unsub-awaiting-' || lpad(i::text, 6, '0') || '-xxxxxxxx'
        from unnest(${cases.map((_, i) => i)}::int[], ${cases.map((c) => c.status)}::text[], ${cases.map((c) => c.confirmed)}::bool[], ${cases.map((c) => c.token)}::bool[]) as u(i, st, c, t)
        returning email, status, confirmed_at, awaiting_confirmation(subscribers) as sql_awaiting`;
      expect(rows).toHaveLength(cases.length);
      for (const r of rows) expect([r.email, r.sql_awaiting]).toEqual([r.email, billing.awaitingConfirmation(r)]);
      // A confirmed owner who unsubscribed is never waiting, whatever token a later sign-up set.
      expect(rows.filter((r: { sql_awaiting: boolean }) => r.sql_awaiting).map((r: { status: string; confirmed_at: Date | null }) => [r.status, r.confirmed_at]))
        .toEqual(expect.arrayContaining([["pending", null], ["unsubscribed", null]]));
      expect(rows.filter((r: { sql_awaiting: boolean; confirmed_at: Date | null }) => r.sql_awaiting && r.confirmed_at !== null)).toHaveLength(0);
      await sql`delete from subscribers where email like 'awaiting-%'`;
    });
  });

  describe("one running subscription per address", () => {
    it("two public checkouts: the second isn't prepared while the first is open; a second subscription is canceled, not applied", async () => {
      const first = await billing.startCheckout({ email: "two-tabs@example.org", plan: "monthly", search: null });
      expect(first).toMatchObject({ ok: true, trial: true });
      // A second tab, straight away: refused, with a neutral reply.
      expect(await billing.startCheckout({ email: "two-tabs@example.org", plan: "quarterly", search: null }))
        .toEqual({ ok: false, error: "Your checkout is already open. If you closed it, try again in 5 minutes." });
      expect(links.checkoutReply({ ok: false, error: billing.CHECKOUT_ALREADY_OPEN }, "quarterly")).toEqual({ status: "error", message: billing.CHECKOUT_ALREADY_OPEN });
      // 5 minutes later (the first checkout was closed without paying) a new one is prepared.
      await sql`update paddle_checkouts set created_at = now() - interval '6 minutes' where ref = ${(first as { ref: string }).ref}`;
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
      // Once Paddle confirmed the cancel, one short note to the customer about the refund.
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "two-tabs@example.org", subject: "We canceled a duplicate plan", key: `duplicate-plan:${subB}` });
      expect(sent[0].text).toContain("reply to this email and we'll refund the charge");
      sent.length = 0;
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
      expect(sent).toHaveLength(0);
      // A later cancel retry for the same flag doesn't email again.
      expect(await billing.cancelFlaggedSubscription(subB, "duplicate_subscription")).toBe(true);
      expect(sent).toHaveLength(0);
      expect((await sql`select paddle_subscription_id from subscribers where email = 'two-tabs@example.org'`)[0].paddle_subscription_id).toBe(subA);
    });

    it("two continue links: both checkouts open, the second subscription is canceled and the first stays", async () => {
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, unsubscribe_token) values ('two-links@example.org', 'confirmed', now(), ${tok("two-links@example.org")})
        returning id::int as id`;
      const t1 = await links.createCheckoutLink(r.id, { plan: "monthly", search: null });
      const t2 = await links.createCheckoutLink(r.id, { plan: "monthly", search: null });
      const c1 = await links.continueCheckout(t1, "monthly");
      expect(c1).toMatchObject({ ok: true, trial: true });
      // The second link straight away: refused while the first checkout may be open, and given back.
      expect(await links.continueCheckout(t2, "monthly")).toEqual({ ok: false, error: billing.CHECKOUT_ALREADY_OPEN });
      // Over 5 minutes later it works (and here both checkouts are paid after all).
      await sql`update paddle_checkouts set created_at = now() - interval '6 minutes' where ref = ${(c1 as { ref: string }).ref}`;
      const c2 = await links.continueCheckout(t2, "monthly");
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

    it("a failed cancel whose trial then turned into a paid plan is canceled at once, and the flag says to refund", async () => {
      const subId = "sub_01hv8x29kz0t586xy6zn1a7u12";
      const r = await trial("converted@example.org", { endsInDays: 1, sub: subId });
      paddleDown = true;
      expect((await billing.runBillingSafety() as { unconfirmed: unknown }).unconfirmed).toEqual({ canceled: 0, failed: 1 });
      const detail = async () => (await sql`select detail, cancel_done_at from billing_flags where subscription_id = ${subId}`)[0];
      expect((await detail()).detail).toBe(billing.cancelFailedDetail("trial_unconfirmed", "Paddle API returned HTTP 500 (internal_error)"));
      expect((await detail()).detail).toMatch(/before the trial ends/);

      // The trial ended before the next run (Paddle's event made it active): step 1 no longer sees
      // it, step 2 retries it. Paddle still down: the flag now says a payment may have been taken.
      await sql`update subscribers set billing_status = 'active', trial_ends_at = now() - interval '1 hour' where id = ${r.id}`;
      paddleCalls.length = 0;
      expect(await billing.runBillingSafety()).toMatchObject({ unconfirmed: { canceled: 0, failed: 0 }, cancelRetries: { canceled: 0, failed: 1 } });
      expect(paddleCalls[0]).toBe(`POST /subscriptions/${subId}/cancel`);
      expect((await detail()).detail).toMatch(/^Cancel in Paddle failed .*a payment may already have been taken.*refund/);

      // Paddle answers: canceled at once; the flag says to refund the payment.
      paddleDown = false;
      paddleCalls.length = 0;
      expect(await billing.runBillingSafety()).toMatchObject({ cancelRetries: { canceled: 1, failed: 0 } });
      expect(paddleCalls).toEqual([`POST /subscriptions/${subId}/cancel`]);
      const done = await detail();
      expect(done.detail).toBe(billing.UNCONFIRMED_DETAIL.convertedDone);
      expect(done.cancel_done_at).not.toBeNull();
      // Done: not tried again.
      paddleCalls.length = 0;
      expect(await billing.runBillingSafety()).toMatchObject({ cancelRetries: { canceled: 0, failed: 0 } });
      expect(paddleCalls).toEqual([]);
      await sql`delete from subscribers where id = ${r.id}`;
    });

    it("a failed cancel is not retried once the owner confirmed the address, or once the subscription stopped running", async () => {
      const confirmedSub = "sub_01hv8x29kz0t586xy6zn1a7u13", endedSub = "sub_01hv8x29kz0t586xy6zn1a7u14";
      const a = await trial("confirmed-late@example.org", { endsInDays: 1, sub: confirmedSub });
      const b = await trial("ended-early@example.org", { endsInDays: 1, sub: endedSub });
      paddleDown = true;
      expect((await billing.runBillingSafety() as { unconfirmed: unknown }).unconfirmed).toEqual({ canceled: 0, failed: 2 });
      paddleDown = false;
      // The owner confirmed one (the plan is theirs now); the other ended in Paddle after its trial.
      await sql`update subscribers set status = 'confirmed', confirmed_at = now(), billing_status = 'active' where id = ${a.id}`;
      await sql`update subscribers set billing_status = 'canceled', trial_ends_at = now() - interval '1 hour' where id = ${b.id}`;
      paddleCalls.length = 0;
      expect(await billing.runBillingSafety()).toMatchObject({ unconfirmed: { canceled: 0, failed: 0 }, cancelRetries: { canceled: 0, failed: 0 } });
      expect(paddleCalls).toEqual([]);
      const flags = await sql`select subscription_id, detail, resolved_at is not null as resolved from billing_flags where subscription_id in (${confirmedSub}, ${endedSub}) order by subscription_id`;
      expect(flags).toEqual([
        { subscription_id: confirmedSub, detail: billing.UNCONFIRMED_DETAIL.confirmed, resolved: true },
        { subscription_id: endedSub, detail: billing.UNCONFIRMED_DETAIL.ended, resolved: false },
      ]);
      const [{ updated_at }] = await sql`select updated_at from billing_flags where subscription_id = ${endedSub}`;
      await billing.runBillingSafety();
      expect((await sql`select updated_at from billing_flags where subscription_id = ${endedSub}`)[0].updated_at).toEqual(updated_at);
      await sql`delete from subscribers where id in (${a.id}, ${b.id})`;
      await sql`delete from billing_flags where subscription_id in (${confirmedSub}, ${endedSub})`;
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

    it("a trial canceled for want of confirmation doesn't use up the free trial, even if the owner confirms later", async () => {
      const subId = "sub_01hv8x29kz0t586xy6zn1a7w01";
      const [r] = await sql`
        insert into subscribers (email, status, confirm_token, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, confirm_sent_at, unsubscribe_token)
        values ('late-confirm@example.org', 'pending', ${"confirm-lateconfirm".padEnd(24, "x")}, 'trialing', 'premium', 'month', ${subId},
                now() + interval '1 day', now() - interval '13 days', ${tok("late-confirm@example.org")})
        returning id::int as id`;
      // A second one whose owner also signed up for the weekly email (that sign-up shares the token).
      const subId2 = "sub_01hv8x29kz0t586xy6zn1a7w02";
      await sql`
        insert into subscribers (email, status, confirm_token, pending_changes, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, confirm_sent_at, unsubscribe_token)
        values ('late-weekly@example.org', 'pending', ${"confirm-lateweekly".padEnd(24, "x")}, '{"weekly_search": ""}', 'trialing', 'premium', 'month', ${subId2},
                now() + interval '1 day', now() - interval '13 days', ${tok("late-weekly@example.org")})`;
      expect((await billing.runBillingSafety() as { unconfirmed: unknown }).unconfirmed).toEqual({ canceled: 2, failed: 0 });
      const [after] = await sql`select confirm_token, unconfirmed_trial_sub from subscribers where id = ${r.id}`;
      expect(after).toEqual({ confirm_token: null, unconfirmed_trial_sub: subId });
      // The weekly sign-up's link keeps working.
      expect((await sql`select confirm_token from subscribers where email = 'late-weekly@example.org'`)[0].confirm_token).not.toBeNull();
      expect(await postEvent(subEvent("subscription.canceled", { ...trialing(subId, "", null, 1), status: "canceled", canceled_at: inDays(0) }))).toBe("applied");
      expect((await sql`select confirm_token from subscribers where id = ${r.id}`)[0].confirm_token).toBeNull();

      // The owner signs up for the weekly email later and confirms: the trial is offered again.
      const subscribers = await import("@/lib/subscribers");
      await subscribers.signup({ email: "late-confirm@example.org", kind: "alerts", weeklySearch: "" });
      const [{ confirm_token }] = await sql`select confirm_token from subscribers where id = ${r.id}`;
      const actions = await import("@/app/actions");
      const fd = new FormData();
      fd.set("token", confirm_token);
      expect(await actions.confirmAction({ status: "idle", message: "" }, fd)).toEqual({
        status: "success",
        message: "Your trial was canceled because the address wasn't confirmed in time. You can start it again. Your weekly email comes on Mondays, and only when there are new vacancies that match your search.",
        link: { href: "/pricing/trial", label: "Start the free trial" },
      });
      const [row] = await sql`
        select confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unconfirmed_trial_sub, had_plan(subscribers) as sql_had_plan
        from subscribers where id = ${r.id}`;
      expect(row.confirmed_at).not.toBeNull();
      expect(row.sql_had_plan).toBe(false);
      expect(billing.hadTrialBefore(row)).toBe(false);
      // Now confirmed, so the public form sends the trial through the address's inbox.
      expect(await billing.startCheckout({ email: "late-confirm@example.org", plan: "monthly", search: null }))
        .toEqual({ ok: true, inbox: true, email: "late-confirm@example.org", subscriberId: r.id, live: false });
      await sql`delete from subscribers where email in ('late-confirm@example.org', 'late-weekly@example.org')`;
    });
  });

  describe("a confirmed owner who unsubscribed stays proven", () => {
    it("a stranger's free-weekly sign-up with the address doesn't cancel the trial or stop its reminder", async () => {
      const subId = "sub_01hv8x29kz0t586xy6zn1a7p01";
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, welcome_sent_at, unsubscribe_token)
        values ('proven-owner@example.org', 'confirmed', now() - interval '12 days', 'trialing', 'premium', 'month', ${subId},
                now() + interval '1.5 days', now() - interval '12 days', ${tok("proven-owner@example.org")})
        returning id::int as id`;
      const subscribers = await import("@/lib/subscribers");
      // The owner unsubscribes from emails (the plan keeps running).
      expect(await subscribers.unsubscribe(tok("proven-owner@example.org"))).toBe(r.id);
      // Someone else types the address into the free weekly email form.
      await subscribers.signup({ email: "proven-owner@example.org", kind: "alerts", weeklySearch: "" });
      const [mid] = await sql`select status, confirm_token from subscribers where id = ${r.id}`;
      expect(mid.status).toBe("unsubscribed");
      expect(mid.confirm_token).not.toBeNull();
      sent.length = 0;

      // The daily job: no cancel, no "confirm or we cancel" emails, and the trial reminder still goes.
      expect(await billing.runBillingSafety()).toMatchObject({ unconfirmed: { canceled: 0, failed: 0 } });
      expect(paddleCalls).toEqual([]);
      await sql`update subscribers set confirm_sent_at = now() - interval '20 days' where id = ${r.id}`;
      expect(await notices.runConfirmationRetries()).toEqual({ sent: 0, failed: 0 });
      expect(await notices.runTrialReminders()).toEqual({ sent: 1, failed: 0 });
      expect(sent.map((m) => [m.to, m.key?.startsWith("trial-reminder:")])).toEqual([["proven-owner@example.org", true]]);
      const [after] = await sql`select billing_status, unconfirmed_trial_sub from subscribers where id = ${r.id}`;
      expect(after).toEqual({ billing_status: "trialing", unconfirmed_trial_sub: null });
      expect(await sql`select 1 from billing_flags where subscription_id = ${subId}`).toHaveLength(0);
      await sql`delete from subscribers where id = ${r.id}`;
    });
  });

  describe("a plan canceled in Paddle before its address was proven", () => {
    it("doesn't use up the free trial, and a late confirmation doesn't claim the daily job canceled it", async () => {
      const subId = "sub_01hv8x29kz0t586xy6zn1a7q01";
      const start = await billing.startCheckout({ email: "never-proven@example.org", plan: "monthly", search: null });
      expect(start).toMatchObject({ ok: true, trial: true });
      expect(await postEvent(subEvent("subscription.created", trialing(subId, "", (start as { ref: string }).ref)))).toBe("applied");
      await settle();
      // Whoever started it cancels it in Paddle (e.g. from the confirmation email's account link).
      expect(await postEvent(subEvent("subscription.canceled", { ...trialing(subId, "", (start as { ref: string }).ref), status: "canceled", canceled_at: inDays(0) }))).toBe("applied");
      const [row] = await sql`
        select id::int as id, status, confirmed_at, confirm_token, unconfirmed_trial_sub, had_plan(subscribers) as sql_had_plan
        from subscribers where email = 'never-proven@example.org'`;
      expect(row).toMatchObject({ status: "pending", confirmed_at: null, confirm_token: null, unconfirmed_trial_sub: subId, sql_had_plan: false });

      // The owner signs up for the free weekly email and confirms: the trial was never theirs.
      const subscribers = await import("@/lib/subscribers");
      await subscribers.signup({ email: "never-proven@example.org", kind: "alerts", weeklySearch: "" });
      const [{ confirm_token }] = await sql`select confirm_token from subscribers where id = ${row.id}`;
      const confirmed = await subscribers.confirmSubscriber(confirm_token);
      expect(confirmed).toMatchObject({ ok: true, trialCanceled: false, weeklyEmail: true });
      const [h] = await sql`
        select confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unconfirmed_trial_sub, had_plan(subscribers) as sql_had_plan
        from subscribers where id = ${row.id}`;
      expect(h.confirmed_at).not.toBeNull();
      expect(h.sql_had_plan).toBe(false);
      expect(billing.hadTrialBefore(h)).toBe(false);
      await sql`delete from subscribers where id = ${row.id}`;
    });

    it("a plan canceled after its owner confirmed still counts", async () => {
      const subId = "sub_01hv8x29kz0t586xy6zn1a7q02";
      await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, plan, paddle_subscription_id, trial_ends_at, unsubscribe_token)
        values ('proven-cancel@example.org', 'confirmed', now(), 'trialing', 'premium', ${subId}, now() + interval '10 days', ${tok("proven-cancel@example.org")})`;
      expect(await postEvent(subEvent("subscription.canceled", { ...trialing(subId, "", null), status: "canceled", canceled_at: inDays(0) }))).toBe("applied");
      const [h] = await sql`select unconfirmed_trial_sub, had_plan(subscribers) as sql_had_plan from subscribers where email = 'proven-cancel@example.org'`;
      expect(h).toEqual({ unconfirmed_trial_sub: null, sql_had_plan: true });
      await sql`delete from subscribers where email = 'proven-cancel@example.org'`;
    });
  });

  describe("upgrading from the free weekly email", () => {
    const addJob = (slug: string, title: string, hoursAgo: number) => sql`
      insert into jobs (slug, title, apply_url, apply_host, url_hash, status, first_seen_at, published_at)
      values (${slug}, ${title}, ${`https://example.org/${slug}`}, 'example.org', ${`hash-${slug}`}, 'active',
              now() - make_interval(mins => ${Math.round(hoursAgo * 60)}), now() - make_interval(mins => ${Math.round(hoursAgo * 60)}))`;

    it("switches the plan to daily, and the next daily run sends the first alert with only what the weekly email didn't", async () => {
      // A weekly subscriber (the default frequency) whose free weekly email went out 3 hours ago.
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, weekly_email, unsubscribe_token)
        values ('weekly-upgrade@example.org', 'confirmed', now() - interval '30 days', true, ${tok("weekly-upgrade@example.org")})
        returning id::int as id, frequency`;
      expect(r.frequency).toBe("weekly");
      await sql`insert into saved_searches (subscriber_id, search, label, last_sent_at) values (${r.id}, 'q=welder', 'Welders', now() - interval '3 hours')`;
      await addJob("welder-sent-weekly", "Welder sent in the weekly email", 5);
      await addJob("welder-new", "Welder posted since", 1);

      const token = await links.createCheckoutLink(r.id, { plan: "quarterly", search: "q=welder" });
      const c = await links.continueCheckout(token, "quarterly");
      expect(c).toMatchObject({ ok: true, trial: true });
      const subId = "sub_01hv8x29kz0t586xy6zn1a7x01";
      expect(await postEvent(subEvent("subscription.created", trialing(subId, "", (c as { ref: string }).ref)))).toBe("applied");
      await settle();
      const [s] = await sql`select status, billing_status, frequency, plan_started_at from subscribers where id = ${r.id}`;
      expect(s).toMatchObject({ status: "confirmed", billing_status: "trialing", frequency: "daily" });
      expect(s.plan_started_at).not.toBeNull();
      const welcome = sent.find((m) => m.to === "weekly-upgrade@example.org" && m.key?.startsWith("welcome:"))!;
      expect(welcome.text).toContain("once a day");
      sent.length = 0;

      // The next daily run: due at once (the weekly email went out within the last 20 hours), and
      // only the vacancy first seen after the weekly email.
      await digest.runAlerts();
      expect(sent.filter((m) => m.to === "weekly-upgrade@example.org")).toHaveLength(1);
      const alert = sent.find((m) => m.to === "weekly-upgrade@example.org")!;
      expect(alert.text).toContain("Welder posted since");
      expect(alert.text).not.toContain("Welder sent in the weekly email");
      // Not due again until the normal daily gap has passed.
      await sql`update locks set locked_until = null, holder = null`;
      sent.length = 0;
      await digest.runAlerts();
      expect(sent.filter((m) => m.to === "weekly-upgrade@example.org")).toHaveLength(0);
      await sql`delete from subscribers where id = ${r.id}`;
      await sql`delete from jobs where slug like 'welder-%'`;
    });

    it("the first alert never reaches back before the plan started (beyond one normal daily window)", async () => {
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, plan, frequency, plan_started_at, unsubscribe_token)
        values ('late-weekly-reader@example.org', 'confirmed', now() - interval '60 days', 'trialing', 'premium', 'daily', now() - interval '30 hours',
                ${tok("late-weekly-reader@example.org")})
        returning id::int as id`;
      // The last free weekly email was 3 days ago.
      await sql`insert into saved_searches (subscriber_id, search, label, last_sent_at) values (${r.id}, 'q=plumber', 'Plumbers', now() - interval '3 days')`;
      await addJob("plumber-before-plan", "Plumber before the plan", 50);
      await addJob("plumber-after-plan", "Plumber after the plan", 28);
      await digest.runAlerts();
      expect(sent.filter((m) => m.to === "late-weekly-reader@example.org")).toHaveLength(1);
      const alert = sent.find((m) => m.to === "late-weekly-reader@example.org")!;
      expect(alert.text).toContain("Plumber after the plan");
      expect(alert.text).not.toContain("Plumber before the plan");
      await sql`delete from subscribers where id = ${r.id}`;
      await sql`delete from jobs where slug like 'plumber-%'`;
    });
  });

  describe("the public trial form", () => {
    it("gives the same visitor its open checkout back; anyone else waits 5 minutes", async () => {
      const first = await billing.startCheckout({ email: "reopen@example.org", plan: "monthly", search: null, visitor: "visitor-a" });
      expect(first).toMatchObject({ ok: true, trial: true });
      const ref = (first as { ref: string }).ref;
      const again = await billing.startCheckout({ email: "reopen@example.org", plan: "quarterly", search: "q=nurse", visitor: "visitor-a" });
      expect(again).toEqual({ ok: true, ref, email: "reopen@example.org", trial: true });
      expect((await sql`select plan, search from paddle_checkouts where ref = ${ref}`)[0]).toEqual({ plan: "quarterly", search: "q=nurse" });
      expect(await sql`select 1 from paddle_checkouts c join subscribers s on s.id = c.subscriber_id where s.email = 'reopen@example.org'`).toHaveLength(1);
      expect(await billing.startCheckout({ email: "reopen@example.org", plan: "monthly", search: null, visitor: "visitor-b" }))
        .toEqual({ ok: false, error: "Your checkout is already open. If you closed it, try again in 5 minutes." });
      expect(await billing.startCheckout({ email: "reopen@example.org", plan: "monthly", search: null }))
        .toEqual({ ok: false, error: billing.CHECKOUT_ALREADY_OPEN });
    });

    it("a confirmed address that never had a plan gets “check your inbox”, and its trial through the emailed link", async () => {
      const [r] = await sql`
        insert into subscribers (email, status, confirmed_at, weekly_email, unsubscribe_token)
        values ('weekly-reader@example.org', 'confirmed', now() - interval '30 days', true, ${tok("weekly-reader@example.org")})
        returning id::int as id`;
      const res = await billing.startCheckout({ email: "weekly-reader@example.org", plan: "quarterly", search: null, visitor: "stranger" });
      expect(res).toEqual({ ok: true, inbox: true, email: "weekly-reader@example.org", subscriberId: r.id, live: false });
      expect(links.checkoutReply(res, "quarterly")).toEqual({ status: "inbox", message: links.CHECK_INBOX });
      // Nothing was prepared for Paddle from the public form.
      expect(await sql`select 1 from paddle_checkouts where subscriber_id = ${r.id}`).toHaveLength(0);
      sent.length = 0;
      expect(await links.sendCheckoutLink({ subscriberId: r.id, email: "weekly-reader@example.org", live: false }, { plan: "quarterly", search: null })).toBe(true);
      const token = sent[0].text.match(/\/account\/continue\?token=([\w-]+)/)![1];
      expect(await links.findCheckoutLink(token)).toEqual({ email: "weekly-reader@example.org", plan: "quarterly", state: "new" });
      const c = await links.continueCheckout(token, "quarterly");
      expect(c).toMatchObject({ ok: true, trial: true, transactionId: null });
      expect((await sql`select trial_allowed, address_proven from paddle_checkouts where ref = ${(c as { ref: string }).ref}`)[0])
        .toEqual({ trial_allowed: true, address_proven: true });
      await sql`delete from subscribers where id = ${r.id}`;
    });
  });

  describe("daily job heartbeat", () => {
    it("is stored by a successful run of /api/cron/digest (billing safety first) and reported by /api/health as a yes/no only", async () => {
      const heartbeat = await import("@/lib/heartbeat");
      const { GET: health } = await import("@/app/api/health/route");
      await sql`delete from settings where key in (${heartbeat.DAILY_JOB_KEY}, ${heartbeat.BILLING_SAFETY_KEY})`;
      // No run yet: 503 for a plain status monitor, with the same JSON.
      const before = await health();
      expect(before.status).toBe(503);
      expect(await before.json()).toMatchObject({ ok: true, dailyJobFresh: false });
      expect(await heartbeat.readDailyJob()).toEqual({ at: null, billing: null });

      process.env.CRON_SECRET = "test-cron-secret-0123456789abcdef";
      try {
        const { GET } = await import("@/app/api/cron/digest/route");
        const res = await GET(new Request("http://localhost/api/cron/digest", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
        expect(res.status).toBe(200);
        expect((await res.json()).billing).toEqual({ unconfirmed: { canceled: 0, failed: 0 }, cancelRetries: { canceled: 0, failed: 0 }, customers: { verified: 0, mismatch: 0, unverified: 0 } });
      } finally {
        delete process.env.CRON_SECRET;
      }
      const job = await heartbeat.readDailyJob();
      expect(heartbeat.dailyJobFresh(job.at)).toBe(true);
      expect(job.billing).toMatchObject({ unconfirmed: { canceled: 0, failed: 0 } });
      const fresh = await health();
      expect(fresh.status).toBe(200);
      const body = await fresh.json();
      expect(body.dailyJobFresh).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/unconfirmed|cancel/);
      // Over 26 hours without a run: stale, 503.
      await sql`update settings set value = ${new Date(Date.now() - 27 * 3600_000).toISOString()} where key = ${heartbeat.DAILY_JOB_KEY}`;
      const stale = await health();
      expect(stale.status).toBe(503);
      expect((await stale.json()).dailyJobFresh).toBe(false);
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

    it("a cancel marked dealt with is still retried until Paddle confirms it, and can't be marked dealt with while pending", async () => {
      const blocked = "sub_01hv8x29kz0t586xy6zn1a7v11", dup = "sub_01hv8x29kz0t586xy6zn1a7v12", unconf = "sub_01hv8x29kz0t586xy6zn1a7v13";
      const [r] = await sql`
        insert into subscribers (email, status, confirm_token, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, unsubscribe_token)
        values ('resolved-unconfirmed@example.org', 'pending', ${"confirm-resolved-unconfirmed".padEnd(24, "x")}, 'active', 'premium', 'month', ${unconf},
                now() - interval '1 day', ${tok("resolved-unconfirmed@example.org")})
        returning id::int as id`;
      // Marked dealt with (before this rule, or by hand in the database) while the cancel hadn't gone through.
      await sql`
        insert into billing_flags (subscription_id, kind, subscriber_id, detail, resolved_at) values
          (${blocked}, 'trial_blocked', null, 'Cancel in Paddle failed (timeout).', now()),
          (${dup}, 'duplicate_subscription', null, 'Cancel in Paddle failed (timeout).', now()),
          (${unconf}, 'trial_unconfirmed', ${r.id}, 'Cancel in Paddle failed (timeout).', now())`;
      expect((await billing.pendingCancels()).map((p) => p.subscription_id).sort()).toEqual([blocked, dup, unconf].sort());

      // The webhook still holds a held-back subscription back and asks for the cancel again.
      const ref = "held-back-checkout-ref-000001";
      await sql`insert into paddle_checkouts (ref, subscriber_id, plan) values (${ref}, ${r.id}, 'monthly')`;
      paddleDown = true;
      expect(await postEvent(subEvent("subscription.updated", trialing(blocked, "", ref)))).toBe("flagged");
      await settle();
      expect(paddleCalls).toContain(`POST /subscriptions/${blocked}/cancel`);

      // The admin can't mark a pending cancel dealt with.
      const { resolveBillingFlagAction } = await import("@/app/admin/actions");
      await sql`update billing_flags set resolved_at = null where subscription_id = ${dup}`;
      const form = new FormData();
      form.set("subscription_id", dup);
      form.set("kind", "duplicate_subscription");
      await resolveBillingFlagAction(form);
      expect((await sql`select resolved_at from billing_flags where subscription_id = ${dup}`)[0].resolved_at).toBeNull();

      // The daily job retries all three; once done, they're no longer pending and can be marked dealt with.
      paddleDown = false;
      paddleCalls.length = 0;
      expect(await billing.runBillingSafety()).toMatchObject({ cancelRetries: { canceled: 3, failed: 0 } });
      expect(paddleCalls.sort()).toEqual([blocked, dup, unconf].map((id) => `POST /subscriptions/${id}/cancel`).sort());
      expect(await billing.pendingCancels({ only: [blocked, dup, unconf] })).toEqual([]);
      await resolveBillingFlagAction(form);
      expect((await sql`select resolved_at from billing_flags where subscription_id = ${dup}`)[0].resolved_at).not.toBeNull();
      await sql`delete from billing_flags where subscription_id in (${blocked}, ${dup}, ${unconf})`;
      await sql`delete from subscribers where id = ${r.id}`;
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
