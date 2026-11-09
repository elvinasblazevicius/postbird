/**
 * One free trial per email address, against a real database: a new address
 * (or one that never had a plan) goes straight to the trial checkout; an
 * address that has or had a plan gets the same "check your inbox" reply and
 * its next step by email (the account link, or a single-use link to the
 * continue page, which prepares a Paddle transaction without a trial; Paddle's
 * API is mocked); a subscription that starts active gets its own welcome
 * without trial wording and no trial reminder.
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
// The server actions read the request's headers (rate limits per connection).
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0 test" }) }));
const settle = async () => { await Promise.all(afterTasks.splice(0)); };

const TEST_DB = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "pdl_ntfset_test_secret_0123456789";
const API_KEY = "pdl_sdbx_apikey_test_0123456789";
const PRICE_MONTHLY = "pri_01hv0vax6rv18t4tamj848nm01";
const PRICE_QUARTERLY = "pri_01hv0vax6rv18t4tamj848nq03";
const PRODUCT = "pro_01hv0vax6rv18t4tamj848ne4e";
const TXN = "txn_01hv8wptq8987qeep44cyrewp9";

/** Paddle customers the API stub knows (GET /customers/{id}). */
const CUSTOMERS: Record<string, string> = {
  ctm_01hv6y1jedq4p1n0yqn5ba3k70: "again@example.org",
  ctm_01hv6y1jedq4p1n0yqn5ba3k72: "back@example.org",
};

type Sent = { to: string; subject: string; text: string; key?: string };
type PaddleCall = { method: string; url: string; body: Record<string, unknown> | null };

const catalogPrice = (id: string) => ({
  id,
  product_id: PRODUCT,
  description: id === PRICE_QUARTERLY ? "Daily alerts, 3 months" : "Daily alerts, monthly",
  name: id === PRICE_QUARTERLY ? "Every 3 months" : "Monthly",
  billing_cycle: { interval: "month", frequency: id === PRICE_QUARTERLY ? 3 : 1 },
  trial_period: { interval: "day", frequency: 14 },
  tax_mode: "account_setting",
  unit_price: { amount: id === PRICE_QUARTERLY ? "1999" : "999", currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
});

const tok = (email: string) => `unsub-${email.replace(/[^\w-]/g, "-")}`.padEnd(24, "x");

describe.skipIf(!TEST_DB)("one free trial per email address (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let billing: typeof import("@/lib/billing/subscriptions");
  let links: typeof import("@/lib/billing/checkout-links");
  let paddle: typeof import("@/lib/billing/paddle");
  let notices: typeof import("@/lib/billing/notices");
  let actions: typeof import("@/app/billing-actions");
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
  /** The token of the continue link in the last email to this address. */
  const linkToken = (to: string) => {
    const m = [...sent].reverse().find((x) => x.to === to);
    return m?.text.match(/\/account\/continue\?token=([\w-]+)/)?.[1] ?? null;
  };
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
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
        const ctm = u.match(/\/customers\/(ctm_\w+)$/)?.[1];
        if (method === "GET" && ctm && CUSTOMERS[ctm]) return Response.json({ data: { id: ctm, email: CUSTOMERS[ctm] } });
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    });

    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    }
    await sql.unsafe(`truncate subscribers, saved_searches, paddle_checkouts, paddle_events, events, rate_limits, billing_flags, checkout_links, trial_markers restart identity cascade`);
    billing = await import("@/lib/billing/subscriptions");
    links = await import("@/lib/billing/checkout-links");
    paddle = await import("@/lib/billing/paddle");
    notices = await import("@/lib/billing/notices");
    actions = await import("@/app/billing-actions");
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
    expect((await sql`select trial_allowed from paddle_checkouts where ref = ${(res as { ref: string }).ref}`)[0].trial_allowed).toBe(true);
  });

  it("an existing address that never had a plan (early access, or the free weekly email) keeps the trial checkout", async () => {
    await sql`insert into subscribers (email, status, premium_waitlist, unsubscribe_token) values ('early@example.org', 'confirmed', true, ${tok("early")})`;
    await sql`insert into subscribers (email, status, wants_alerts, weekly_email, unsubscribe_token) values ('weekly@example.org', 'confirmed', true, true, ${tok("weekly")})`;
    for (const email of ["early@example.org", "weekly@example.org"]) {
      const res = await billing.startCheckout({ email, plan: "monthly", search: null });
      expect(res).toMatchObject({ ok: true, trial: true });
    }
    expect(paddleCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("an address whose trial was canceled gets a link by email; the continue page prepares the plan without a trial", async () => {
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
    const [row] = await sql`select id::int as id, billing_status from subscribers where email = 'again@example.org'`;
    expect(row.billing_status).toBe("canceled");
    const checkoutsBefore = (await sql`select count(*)::int as n from paddle_checkouts`)[0].n;
    paddleCalls.length = 0;

    // The form: nothing about the address, and no checkout yet.
    const res = await billing.startCheckout({ email: "again@example.org", plan: "quarterly", search: "q=data" });
    expect(res).toEqual({ ok: true, inbox: true, email: "again@example.org", subscriberId: row.id, live: false });
    expect((await sql`select count(*)::int as n from paddle_checkouts`)[0].n).toBe(checkoutsBefore);
    expect(paddleCalls).toHaveLength(0);

    // The email: a single-use link (no address in it), valid 24 hours.
    expect(await links.sendCheckoutLink({ subscriberId: row.id, email: "again@example.org", live: false }, { plan: "quarterly", search: "q=data" })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Continue to Postbird daily alerts");
    expect(sent[0].text).toContain("expires in 24 hours");
    expect(sent[0].text).not.toMatch(/again%40|again@/);
    const token = linkToken("again@example.org")!;
    expect(token).toMatch(/^[\w-]{32}$/);
    expect(await sql`select 1 from checkout_links where token_hash = ${token}`).toHaveLength(0); // only a hash is stored

    // Opening the page doesn't use the link up, and shows the terms without a trial.
    expect(await links.findCheckoutLink(token)).toEqual({ email: "again@example.org", plan: "quarterly", state: "returning" });
    expect(await links.findCheckoutLink(token)).not.toBeNull();

    const go = await links.continueCheckout(token, "quarterly");
    expect(go).toMatchObject({ ok: true, email: "again@example.org", trial: false, transactionId: TXN });
    const ref = (go as { ref: string }).ref;
    expect(ref).not.toBe(firstRef);
    expect(paddleCalls.map((c) => `${c.method} ${c.url.replace("https://sandbox-api.paddle.com", "")}`)).toEqual([`GET /prices/${PRICE_QUARTERLY}`, "POST /transactions"]);
    const body = paddleCalls[1].body as { items: { quantity: number; price: Record<string, unknown> }[]; custom_data: unknown };
    expect(body.custom_data).toEqual({ ref });
    expect(body.items[0].price).toMatchObject({ product_id: PRODUCT, trial_period: null, billing_cycle: { interval: "month", frequency: 3 }, unit_price: { amount: "1999", currency_code: "USD" } });
    // The email never goes into a Paddle URL.
    expect(paddleCalls.some((c) => c.url.includes("again") || c.url.includes("%40"))).toBe(false);
    // The checkout record the webhook matches the subscription with: no trial allowed; opening
    // the emailed link proved the address, so paying confirms it.
    expect(await sql`select plan, search, trial_allowed, new_subscriber from paddle_checkouts where ref = ${ref}`)
      .toEqual([{ plan: "quarterly", search: "q=data", trial_allowed: false, new_subscriber: true }]);

    // Single use.
    expect(await links.findCheckoutLink(token)).toBeNull();
    expect(await links.continueCheckout(token, "quarterly")).toEqual({ ok: false, error: links.LINK_USED, used: true });
  });

  it("if the no-trial checkout can't be prepared, the link is given back and the trial is never offered", async () => {
    const [row] = await sql`
      insert into subscribers (email, status, billing_status, paddle_subscription_id, trial_ends_at, canceled_at, unsubscribe_token)
      values ('down@example.org', 'confirmed', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a71aa', '2026-10-15', '2026-10-10', ${tok("down")})
      returning id::int as id`;
    const token = await links.createCheckoutLink(row.id, { plan: "monthly", search: null });
    const before = (await sql`select count(*)::int as n from paddle_checkouts`)[0].n;
    paddleDown = true;
    expect(await links.continueCheckout(token, "monthly")).toEqual({ ok: false, error: billing.CHECKOUT_UNAVAILABLE });
    // No API key at all: the same answer, without calling Paddle.
    paddleDown = false;
    paddleCalls.length = 0;
    delete process.env.PADDLE_API_KEY;
    try {
      expect(await links.continueCheckout(token, "monthly")).toEqual({ ok: false, error: billing.CHECKOUT_UNAVAILABLE });
      expect(paddleCalls).toHaveLength(0);
    } finally {
      process.env.PADDLE_API_KEY = API_KEY;
    }
    expect((await sql`select count(*)::int as n from paddle_checkouts`)[0].n).toBe(before);
    // Still usable once Paddle answers.
    expect(await links.continueCheckout(token, "monthly")).toMatchObject({ ok: true, trial: false, transactionId: TXN });
  });

  it("an expired link doesn't work", async () => {
    const [row] = await sql`select id::int as id from subscribers where email = 'down@example.org'`;
    const token = await links.createCheckoutLink(row.id, { plan: "monthly", search: null });
    await sql`update checkout_links set expires_at = now() - interval '1 minute' where used_at is null`;
    expect(await links.findCheckoutLink(token)).toBeNull();
    expect(await links.continueCheckout(token, "monthly")).toMatchObject({ ok: false, used: true });
  });

  it("the form gives the same reply for a running plan and a past one; the emails differ", async () => {
    await sql`delete from rate_limits`;
    const [live] = await sql`
      insert into subscribers (email, status, billing_status, plan_interval, paddle_subscription_id, welcome_sent_at, unsubscribe_token)
      values ('paying@example.org', 'confirmed', 'active', 'month', 'sub_01hv8x29kz0t586xy6zn1a74aa', now(), ${tok("paying")})
      returning id::int as id, manage_token`;
    const a = await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "paying@example.org", plan: "monthly" }));
    const b = await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "down@example.org", plan: "monthly" }));
    expect(a).toEqual({ status: "inbox", message: "Check your inbox: we've emailed this address a link to continue." });
    expect(b).toEqual(a);
    // The emails go out after the response.
    await settle();
    const toLive = sent.find((m) => m.to === "paying@example.org")!;
    expect(toLive.subject).toBe("You already have Postbird daily alerts");
    const [{ manage_token }] = await sql`select manage_token from subscribers where id = ${live.id}`;
    expect(manage_token).not.toBe(live.manage_token); // a new account link, replacing the old one once sent
    expect(toLive.text).toContain(`/account?t=${manage_token}`);
    expect(toLive.text).not.toContain("/account/continue");
    expect(linkToken("down@example.org")).toMatch(/^[\w-]{32}$/);
    // A new address goes straight to the trial checkout.
    const c = await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "brand-new@example.org", plan: "quarterly" }));
    expect(c).toMatchObject({ status: "ready", trial: true, transactionId: null, email: "brand-new@example.org" });
  });

  it("checkout emails to one address are capped per hour and per day; the reply doesn't change", async () => {
    await sql`delete from rate_limits`;
    sent.length = 0;
    for (let i = 0; i < 8; i++) {
      expect(await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "down@example.org", plan: "monthly" })))
        .toEqual({ status: "inbox", message: links.CHECK_INBOX });
      await settle();
    }
    // 3 an hour per address.
    expect(sent.filter((m) => m.to === "down@example.org")).toHaveLength(3);
    // And at most 5 in 24 hours, whatever the hourly windows.
    for (let i = 0; i < 6; i++) await links.sendCheckoutLink({ subscriberId: 0, email: "capped-day@example.org", live: false }, { plan: "monthly", search: null }).catch(() => false);
    const [{ n }] = await sql`select count(*)::int as n from rate_limits where key = ${(await import("@/lib/rate-limit")).hashKey("checkout-link-day|capped-day@example.org")}`;
    expect(n).toBe(links.CHECKOUT_LINKS_PER_DAY);
  });

  it("the continue action uses the link up and returns the checkout to open", async () => {
    await sql`delete from rate_limits`;
    const [row] = await sql`select id::int as id from subscribers where email = 'down@example.org'`;
    const token = await links.createCheckoutLink(row.id, { plan: "monthly", search: null });
    const res = await actions.continueCheckoutAction({ status: "idle", message: "" }, form({ token, plan: "quarterly" }));
    expect(res).toMatchObject({ status: "ready", trial: false, transactionId: TXN, plan: "quarterly", email: "down@example.org" });
    const again = await actions.continueCheckoutAction({ status: "idle", message: "" }, form({ token, plan: "quarterly" }));
    expect(again).toEqual({ status: "error", message: links.LINK_USED });
  });

  it("a subscription that starts active: its own welcome (a new key), without trial wording, and no trial reminder", async () => {
    // A former subscriber whose welcome went out for the earlier subscription.
    const oldSub = "sub_01hv8x29kz0t586xy6zn1a72aa";
    const [r] = await sql`
      insert into subscribers (email, status, billing_status, paddle_subscription_id, paddle_customer_id, trial_ends_at, canceled_at, billing_event_at, welcome_sent_at, unsubscribe_token)
      values ('back@example.org', 'confirmed', 'canceled', ${oldSub}, 'ctm_01hv6y1jedq4p1n0yqn5ba3k72',
              now() - interval '20 days', now() - interval '25 days', now() - interval '20 days', now() - interval '60 days', ${tok("back")})
      returning id::int as id`;
    const trialsBefore = (await sql`select count(*)::int as n from events where type = 'trial_started'`)[0].n;
    const token = await links.createCheckoutLink(r.id, { plan: "monthly", search: "q=pilot" });
    const start = await links.continueCheckout(token, "monthly");
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
      select id::int as id, billing_status, plan, plan_interval, paddle_subscription_id, trial_ends_at, canceled_at, welcome_sent_at, welcome_claimed_at, trial_reminder_sent_at
      from subscribers where email = 'back@example.org'`;
    expect(s).toMatchObject({ billing_status: "active", plan: "premium", plan_interval: "month", paddle_subscription_id: subId, trial_ends_at: null, canceled_at: null, trial_reminder_sent_at: null, welcome_claimed_at: null });
    // The welcome for the earlier subscription doesn't count for this one.
    expect(new Date(s.welcome_sent_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await sql`select search from saved_searches where subscriber_id = ${s.id}`).map((x: { search: string }) => x.search)).toEqual(["q=pilot"]);
    // Not counted as a trial.
    expect((await sql`select count(*)::int as n from events where type = 'trial_started'`)[0].n).toBe(trialsBefore);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "back@example.org", key: `welcome:${s.id}:${subId}` });
    expect(sent[0].subject).toBe("Your Postbird daily alerts are on");
    expect(sent[0].text).not.toMatch(/trial/i);
    expect(sent[0].text).toContain("renewing automatically until you cancel");

    // No trial reminder, now or later.
    sent.length = 0;
    expect(await notices.runTrialReminders()).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("the welcome retry for an active plan doesn't mention an earlier trial left on the row", async () => {
    const subId = "sub_01hv8x29kz0t586xy6zn1a73aa";
    const [r] = await sql`
      insert into subscribers (email, status, billing_status, plan_interval, paddle_subscription_id, trial_ends_at, unsubscribe_token)
      values ('retry@example.org', 'confirmed', 'active', 'quarter', ${subId}, now() - interval '40 days', ${tok("retry")})
      returning id::int as id`;
    expect(await notices.runWelcomeRetries()).toEqual({ sent: 1, failed: 0 });
    const m = sent.find((x) => x.to === "retry@example.org")!;
    expect(m.key).toBe(`welcome:${r.id}:${subId}`);
    expect(m.text).not.toMatch(/trial/i);
  });

  it("“Cancel my plan” on the unsubscribe page emails the account link worded for cancelling, and opens nothing", async () => {
    await sql`delete from rate_limits`;
    const res = await actions.unsubscribeCancelLinkAction({ status: "idle", message: "" }, form({ token: tok("paying") }));
    expect(res).toEqual({ status: "success", message: "We've emailed you a link to cancel your plan." });
    expect(paddleCalls).toHaveLength(0);
    const m = sent.find((x) => x.to === "paying@example.org")!;
    expect(m.subject).toBe("Your link to cancel your Postbird plan");
    expect(m.text).toContain("Cancel or manage billing");
    expect(m.text).toMatch(/\/account\?t=[0-9a-f]{64}/);
    // A malformed token isn't looked up.
    expect(await actions.unsubscribeCancelLinkAction({ status: "idle", message: "" }, form({ token: "bad\u0000token-xxxxxxxxxxxxxx" })))
      .toMatchObject({ status: "error" });
  });
});
