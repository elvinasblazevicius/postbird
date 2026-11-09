/**
 * One free trial per person, against a real database: a returning address
 * gets a Paddle transaction without a trial (Paddle's API is mocked), a new
 * address keeps the trial checkout, and a subscription that starts active
 * gets a welcome without trial wording and no trial reminder.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables
 * are emptied). Email sending (Resend) is replaced by a stub.
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
const PRICE_MONTHLY = "pri_01hv0vax6rv18t4tamj848nm01";
const PRICE_QUARTERLY = "pri_01hv0vax6rv18t4tamj848nq03";
const PRODUCT = "pro_01hv0vax6rv18t4tamj848ne4e";
const TXN = "txn_01hv8wptq8987qeep44cyrewp9";

type Sent = { to: string; subject: string; text: string; key?: string };
type PaddleCall = { method: string; url: string; body: Record<string, unknown> | null };

const catalogPrice = (id: string) => ({
  id,
  product_id: PRODUCT,
  description: id === PRICE_QUARTERLY ? "Email alerts, 3 months" : "Email alerts, monthly",
  name: id === PRICE_QUARTERLY ? "Every 3 months" : "Monthly",
  billing_cycle: { interval: "month", frequency: id === PRICE_QUARTERLY ? 3 : 1 },
  trial_period: { interval: "day", frequency: 14 },
  tax_mode: "account_setting",
  unit_price: { amount: id === PRICE_QUARTERLY ? "1999" : "999", currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
});

describe.skipIf(!TEST_DB)("one free trial per person (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let billing: typeof import("@/lib/billing/subscriptions");
  let paddle: typeof import("@/lib/billing/paddle");
  let notices: typeof import("@/lib/billing/notices");
  const sent: Sent[] = [];
  const paddleCalls: PaddleCall[] = [];
  let paddleDown = false;
  let eventSeq = 0;

  const subEvent = (type: string, data: Record<string, unknown>, occurredAt = new Date().toISOString()) => ({
    event_id: `evt_onetrial_${++eventSeq}`, event_type: type, occurred_at: occurredAt, notification_id: `ntf_onetrial_${eventSeq}`, data,
  });
  const postEvent = async (event: ReturnType<typeof subEvent>) => {
    const { POST } = await import("@/app/api/paddle/webhook/route");
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    return POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${paddle.signPayload(body, ts, WEBHOOK_SECRET)}` } }));
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PADDLE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.PADDLE_API_KEY = API_KEY;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = "test_client_token";
    process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY = PRICE_MONTHLY;
    process.env.NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY = PRICE_QUARTERLY;
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
        paddleCalls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
        if (paddleDown) return Response.json({ error: { code: "internal_error" } }, { status: 500 });
        const price = u.match(/\/prices\/(pri_\w+)$/)?.[1];
        if (method === "GET" && (price === PRICE_MONTHLY || price === PRICE_QUARTERLY)) return Response.json({ data: catalogPrice(price) });
        if (method === "POST" && u.endsWith("/transactions")) return Response.json({ data: { id: TXN, status: "draft" } }, { status: 201 });
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });

    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    }
    await sql.unsafe(`truncate subscribers, saved_searches, paddle_checkouts, paddle_events, events, rate_limits restart identity cascade`);
    billing = await import("@/lib/billing/subscriptions");
    paddle = await import("@/lib/billing/paddle");
    notices = await import("@/lib/billing/notices");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
    await sql?.end();
  });

  beforeEach(() => {
    sent.length = 0;
    paddleCalls.length = 0;
    afterTasks.length = 0;
    paddleDown = false;
  });

  it("a new address keeps the trial checkout and Paddle's API isn't called", async () => {
    const res = await billing.startCheckout({ email: "Fresh@Example.org", plan: "quarterly", search: "q=nurse" });
    expect(res).toMatchObject({ ok: true, email: "fresh@example.org", trial: true });
    expect(res).not.toHaveProperty("transactionId");
    expect(paddleCalls).toHaveLength(0);
  });

  it("an existing address that never had a plan (early access) keeps the trial checkout", async () => {
    await sql`insert into subscribers (email, status, premium_waitlist, unsubscribe_token) values ('early@example.org', 'confirmed', true, 'unsub-early')`;
    const res = await billing.startCheckout({ email: "early@example.org", plan: "monthly", search: null });
    expect(res).toMatchObject({ ok: true, trial: true });
    expect(paddleCalls).toHaveLength(0);
  });

  it("an address whose trial was canceled gets the plan without a trial, through a transaction carrying its reference", async () => {
    const first = await billing.startCheckout({ email: "again@example.org", plan: "monthly", search: null });
    const firstRef = (first as { ref: string }).ref;
    const subId = "sub_01hv8x29kz0t586xy6zn1a70aa";
    const customer = "ctm_01hv6y1jedq4p1n0yqn5ba3k70";
    await billing.handlePaddleEvent(subEvent("subscription.created", {
      id: subId, status: "trialing", customer_id: customer, custom_data: { ref: firstRef },
      billing_cycle: { interval: "month", frequency: 1 }, current_billing_period: { starts_at: "2026-11-01T10:00:00Z", ends_at: "2026-11-15T10:00:00Z" },
      items: [{ price: { id: PRICE_MONTHLY }, trial_dates: { starts_at: "2026-11-01T10:00:00Z", ends_at: "2026-11-15T10:00:00Z" } }],
    }, "2026-11-01T10:00:00Z"));
    // Canceled during the trial.
    await billing.handlePaddleEvent(subEvent("subscription.canceled", {
      id: subId, status: "canceled", customer_id: customer, custom_data: { ref: firstRef }, canceled_at: "2026-11-03T10:00:00Z", current_billing_period: null,
      items: [{ price: { id: PRICE_MONTHLY } }],
    }, "2026-11-03T10:00:00Z"));
    expect((await sql`select billing_status from subscribers where email = 'again@example.org'`)[0].billing_status).toBe("canceled");

    const res = await billing.startCheckout({ email: "again@example.org", plan: "quarterly", search: "q=data" });
    expect(res).toMatchObject({ ok: true, email: "again@example.org", trial: false, transactionId: TXN });
    const ref = (res as { ref: string }).ref;
    expect(ref).not.toBe(firstRef);
    expect(paddleCalls.map((c) => `${c.method} ${c.url.replace("https://sandbox-api.paddle.com", "")}`)).toEqual([`GET /prices/${PRICE_QUARTERLY}`, "POST /transactions"]);
    const body = paddleCalls[1].body as { items: { quantity: number; price: Record<string, unknown> }[]; custom_data: unknown };
    expect(body.custom_data).toEqual({ ref });
    expect(body.items).toHaveLength(1);
    expect(body.items[0].price).toMatchObject({ product_id: PRODUCT, trial_period: null, billing_cycle: { interval: "month", frequency: 3 }, unit_price: { amount: "1999", currency_code: "USD" } });
    // The email never goes into a Paddle URL.
    expect(paddleCalls.some((c) => c.url.includes("again") || c.url.includes("%40"))).toBe(false);
    // The checkout record the webhook matches the subscription with.
    expect(await sql`select plan, search from paddle_checkouts where ref = ${ref}`).toEqual([{ plan: "quarterly", search: "q=data" }]);
  });

  it("if the no-trial checkout can't be prepared, a returning address gets an error, never the trial", async () => {
    await sql`
      insert into subscribers (email, status, billing_status, paddle_subscription_id, trial_ends_at, canceled_at, unsubscribe_token)
      values ('down@example.org', 'confirmed', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a71aa', '2026-10-15', '2026-10-10', 'unsub-down')`;
    const before = (await sql`select count(*)::int as n from paddle_checkouts`)[0].n;
    paddleDown = true;
    expect(await billing.startCheckout({ email: "down@example.org", plan: "monthly", search: null }))
      .toEqual({ ok: false, error: "We couldn't open checkout. Please try again or email us.", noTrial: true });
    // No API key at all: the same answer, without calling Paddle.
    paddleDown = false;
    paddleCalls.length = 0;
    delete process.env.PADDLE_API_KEY;
    try {
      expect(await billing.startCheckout({ email: "down@example.org", plan: "monthly", search: null })).toMatchObject({ ok: false, noTrial: true });
      expect(paddleCalls).toHaveLength(0);
    } finally {
      process.env.PADDLE_API_KEY = API_KEY;
    }
    expect((await sql`select count(*)::int as n from paddle_checkouts`)[0].n).toBe(before);
  });

  it("a subscription that starts active: linked by its reference, welcome without trial wording, no trial reminder", async () => {
    // A former subscriber whose earlier trial date is still on the row and whose welcome never went out.
    await sql`
      insert into subscribers (email, status, billing_status, paddle_subscription_id, paddle_customer_id, trial_ends_at, canceled_at, billing_event_at, unsubscribe_token)
      values ('back@example.org', 'confirmed', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a72aa', 'ctm_01hv6y1jedq4p1n0yqn5ba3k72',
              now() - interval '20 days', now() - interval '25 days', now() - interval '20 days', 'unsub-back')`;
    const trialsBefore = (await sql`select count(*)::int as n from events where type = 'trial_started'`)[0].n;
    const start = await billing.startCheckout({ email: "back@example.org", plan: "monthly", search: "q=pilot" });
    expect(start).toMatchObject({ ok: true, trial: false, transactionId: TXN });
    const ref = (start as { ref: string }).ref;

    // What Paddle sends once the transaction is paid: the subscription is active from the start,
    // its item a non-catalog price (no trial dates), and the transaction's custom_data copied over.
    const subId = "sub_01hv8x29kz0t586xy6zn1a72ab";
    const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await postEvent(subEvent("subscription.created", {
      id: subId, status: "active", customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3k72", custom_data: { ref },
      billing_cycle: { interval: "month", frequency: 1 }, current_billing_period: { starts_at: new Date().toISOString(), ends_at: periodEnd }, next_billed_at: periodEnd,
      canceled_at: null, scheduled_change: null,
      items: [{ price: { id: "pri_01hv9noncatalog0000000000aa" }, trial_dates: null }],
    }));
    expect(await res.text()).toBe("applied");
    await settle();

    const [s] = await sql`
      select id::int as id, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, canceled_at, welcome_sent_at, trial_reminder_sent_at
      from subscribers where email = 'back@example.org'`;
    expect(s).toMatchObject({ billing_status: "active", plan: "premium", plan_interval: "month", paddle_subscription_id: subId, trial_ends_at: null, canceled_at: null, trial_reminder_sent_at: null });
    expect(s.welcome_sent_at).not.toBeNull();
    expect((await sql`select search from saved_searches where subscriber_id = ${s.id}`).map((r: { search: string }) => r.search)).toEqual(["q=pilot"]);
    // Not counted as a trial.
    expect((await sql`select count(*)::int as n from events where type = 'trial_started'`)[0].n).toBe(trialsBefore);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "back@example.org", key: `welcome:${s.id}` });
    expect(sent[0].text).not.toMatch(/trial/i);
    expect(sent[0].text).toContain("renewing automatically until you cancel");

    // No trial reminder, now or later.
    sent.length = 0;
    expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("the welcome retry for an active plan doesn't mention an earlier trial left on the row", async () => {
    await sql`
      insert into subscribers (email, status, billing_status, plan_interval, paddle_subscription_id, trial_ends_at, unsubscribe_token)
      values ('retry@example.org', 'confirmed', 'active', 'quarter', 'sub_01hv8x29kz0t586xy6zn1a73aa', now() - interval '40 days', 'unsub-retry')`;
    expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
    const m = sent.find((x) => x.to === "retry@example.org")!;
    expect(m.text).not.toMatch(/trial/i);
  });
});
