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
  /** Paddle answers after this long; paddleHangs: it never answers (only the time limit ends the call). */
  let paddleDelayMs = 0;
  let paddleHangs = false;
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
  /** A checkout form as the browser sends it: the "renews automatically" box ticked unless renewal_ack is given. */
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ renewal_ack: "on", ...fields })) if (v !== "") fd.set(k, v);
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
    // The secret that keys trial markers (the site and the scheduled jobs must share it).
    process.env.ANALYTICS_SALT = "test-analytics-salt-0123456789";

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
        if (paddleHangs) await new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
        if (paddleDelayMs) await new Promise((r) => setTimeout(r, paddleDelayMs));
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
    paddleDelayMs = 0;
    paddleHangs = false;
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
    const created = await billing.handlePaddleEvent(subEvent("subscription.created", {
      id: subId, status: "trialing", customer_id: customer, custom_data: { ref: firstRef },
      billing_cycle: { interval: "month", frequency: 1 }, current_billing_period: { starts_at: "2026-11-01T10:00:00Z", ends_at: "2026-11-15T10:00:00Z" },
      items: [{ price: { id: PRICE_MONTHLY }, trial_dates: { starts_at: "2026-11-01T10:00:00Z", ends_at: "2026-11-15T10:00:00Z" } }],
    }, "2026-11-01T10:00:00Z"));
    // The owner confirms the address (from the email sent after the trial started): the trial now counts.
    expect((await (await import("@/lib/subscribers")).confirmSubscriber(created.confirm!.confirmToken)).ok).toBe(true);
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
    expect(await sql`select plan, search, trial_allowed, new_subscriber, address_proven from paddle_checkouts where ref = ${ref}`)
      .toEqual([{ plan: "quarterly", search: "q=data", trial_allowed: false, new_subscriber: true, address_proven: true }]);

    // Single use.
    expect(await links.findCheckoutLink(token)).toBeNull();
    expect(await links.continueCheckout(token, "quarterly")).toEqual({ ok: false, error: links.LINK_USED, used: true });
  });

  it("if the no-trial checkout can't be prepared, the link is given back and the trial is never offered", async () => {
    const [row] = await sql`
      insert into subscribers (email, status, confirmed_at, billing_status, paddle_subscription_id, trial_ends_at, canceled_at, unsubscribe_token)
      values ('down@example.org', 'confirmed', '2026-09-20', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a71aa', '2026-10-15', '2026-10-10', ${tok("down")})
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

  describe("pressing the continue button", () => {
    const hashOf = async (token: string) => (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
    let id: number;
    beforeAll(async () => {
      [{ id }] = await sql`
        insert into subscribers (email, status, confirmed_at, billing_status, paddle_subscription_id, trial_ends_at, canceled_at, unsubscribe_token)
        values ('double@example.org', 'confirmed', '2026-09-20', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a7d0a', '2026-10-15', '2026-10-10', ${tok("double")})
        returning id::int as id`;
    });
    /** Over 5 minutes ago: an earlier checkout no longer counts as open. */
    const closeOpenCheckouts = () => sql`update paddle_checkouts set created_at = now() - interval '6 minutes' where subscriber_id = ${id}`;

    it("twice at once (a double click) prepares one checkout and one Paddle transaction; the link is used only then", async () => {
      const token = await links.createCheckoutLink(id, { plan: "monthly", search: null });
      paddleDelayMs = 150;
      const results = await Promise.all([links.continueCheckout(token, "monthly"), links.continueCheckout(token, "monthly")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: links.LINK_BUSY });
      expect(paddleCalls.filter((c) => c.method === "POST")).toHaveLength(1);
      expect((await sql`select count(*)::int as n from paddle_checkouts where subscriber_id = ${id}`)[0].n).toBe(1);
      const [link] = await sql`select used_at, claim, claimed_at from checkout_links where token_hash = ${await hashOf(token)}`;
      expect(link.used_at).not.toBeNull();
      expect(link).toMatchObject({ claim: null, claimed_at: null });
      expect(await links.continueCheckout(token, "monthly")).toEqual({ ok: false, error: links.LINK_USED, used: true });
      await closeOpenCheckouts();
    });

    it("a press whose request died holds the link only for its lease", async () => {
      const token = await links.createCheckoutLink(id, { plan: "monthly", search: null });
      await sql`update checkout_links set claim = 'died', claimed_at = now() where token_hash = ${await hashOf(token)}`;
      expect(await links.continueCheckout(token, "monthly")).toEqual({ ok: false, error: links.LINK_BUSY });
      expect(paddleCalls).toHaveLength(0);
      expect(await links.findCheckoutLink(token)).not.toBeNull(); // the page still opens
      await sql`update checkout_links set claimed_at = now() - make_interval(secs => ${links.LINK_CLAIM_SECONDS + 1}) where token_hash = ${await hashOf(token)}`;
      expect(await links.continueCheckout(token, "monthly")).toMatchObject({ ok: true, trial: false, transactionId: TXN });
      await closeOpenCheckouts();
    });

    it("a Paddle that doesn't answer is given up on within the time limit, and the link stays usable", async () => {
      const token = await links.createCheckoutLink(id, { plan: "monthly", search: null });
      paddleHangs = true;
      const t0 = Date.now();
      expect(await links.continueCheckout(token, "monthly")).toEqual({ ok: false, error: billing.CHECKOUT_UNAVAILABLE });
      const took = Date.now() - t0;
      expect(took).toBeGreaterThanOrEqual(paddle.USER_PADDLE_CALL_MS - 100);
      expect(took).toBeLessThan(paddle.USER_PADDLE_CALL_MS + 1500);
      expect(paddleCalls).toHaveLength(1); // the price read; no transaction
      const [link] = await sql`select used_at, claim from checkout_links where token_hash = ${await hashOf(token)}`;
      expect(link).toEqual({ used_at: null, claim: null });
      paddleHangs = false;
      expect(await links.continueCheckout(token, "monthly")).toMatchObject({ ok: true, transactionId: TXN });
      await closeOpenCheckouts();
    }, 10_000);
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
    expect(manage_token).toBe(live.manage_token); // anyone can type the address here: the current link, not replaced
    expect(toLive.text).toContain(`/account?t=${manage_token}`);
    expect(toLive.text).not.toContain("/account/continue");
    expect(linkToken("down@example.org")).toMatch(/^[\w-]{32}$/);
    // A new address goes straight to the trial checkout.
    const c = await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "brand-new@example.org", plan: "quarterly" }));
    expect(c).toMatchObject({ status: "ready", trial: true, transactionId: null, email: "brand-new@example.org" });
  });

  it("the renewal box must be ticked on both forms; the checkout records when, and which wording", async () => {
    await sql`delete from rate_limits`;
    const { RENEWAL_ACK_REQUIRED, renewalTermsVersion } = await import("@/lib/billing/renewal-consent");
    const refused = { status: "error", message: "Please tick the box to agree to automatic renewal." };
    expect(RENEWAL_ACK_REQUIRED).toBe(refused.message);
    expect(await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "no-tick@example.org", plan: "monthly", renewal_ack: "" }))).toEqual(refused);
    expect(await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "no-tick@example.org", plan: "monthly", renewal_ack: "yes" }))).toEqual(refused);
    expect(await sql`select 1 from subscribers where email = 'no-tick@example.org'`).toHaveLength(0);

    const ok = await actions.startCheckoutAction({ status: "idle", message: "" }, form({ email: "ticked@example.org", plan: "monthly" }));
    expect(ok).toMatchObject({ status: "ready", trial: true });
    const [c] = await sql`select renewal_consent_at, renewal_terms_version from paddle_checkouts where ref = ${(ok as { ref: string }).ref}`;
    expect(c.renewal_consent_at).not.toBeNull();
    expect(c.renewal_terms_version).toBe(renewalTermsVersion(true, "monthly"));
    expect(c.renewal_terms_version).toMatch(/^trial-[0-9a-f]{12}$/);
    // The no-trial wording is another version.
    expect(renewalTermsVersion(false, "monthly")).toMatch(/^plan-[0-9a-f]{12}$/);
    expect(renewalTermsVersion(false, "monthly")).not.toBe(renewalTermsVersion(false, "quarterly"));

    // The continue page: refused without the box, and the link stays unused.
    const [row] = await sql`select id::int as id from subscribers where email = 'ticked@example.org'`;
    const token = await links.createCheckoutLink(row.id, { plan: "monthly", search: null });
    expect(await actions.continueCheckoutAction({ status: "idle", message: "" }, form({ token, plan: "monthly", renewal_ack: "" }))).toEqual(refused);
    expect(await links.findCheckoutLink(token)).not.toBeNull();
    await sql`delete from paddle_checkouts where subscriber_id = ${row.id}`;
    await sql`delete from subscribers where id = ${row.id}`;
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
    // The checkout prepared a moment ago (the test above) may still be open: no second one, no
    // second Paddle transaction, and the link is given back.
    paddleCalls.length = 0;
    expect(await actions.continueCheckoutAction({ status: "idle", message: "" }, form({ token, plan: "quarterly" })))
      .toEqual({ status: "error", message: billing.CHECKOUT_ALREADY_OPEN });
    expect(paddleCalls).toHaveLength(0);
    expect(await links.findCheckoutLink(token)).not.toBeNull();
    // Over 5 minutes later it was closed without paying: the same link works.
    await sql`update paddle_checkouts set created_at = now() - interval '6 minutes' where subscriber_id = ${row.id}`;
    const res = await actions.continueCheckoutAction({ status: "idle", message: "" }, form({ token, plan: "quarterly" }));
    expect(res).toMatchObject({ status: "ready", trial: false, transactionId: TXN, plan: "quarterly", email: "down@example.org" });
    // The agreement recorded is the no-trial wording this address was shown.
    const { renewalTermsVersion } = await import("@/lib/billing/renewal-consent");
    const [c] = await sql`select renewal_consent_at, renewal_terms_version from paddle_checkouts where ref = ${(res as { ref: string }).ref}`;
    expect(c.renewal_consent_at).not.toBeNull();
    expect(c.renewal_terms_version).toBe(renewalTermsVersion(false, "quarterly"));
    const again = await actions.continueCheckoutAction({ status: "idle", message: "" }, form({ token, plan: "quarterly" }));
    expect(again).toEqual({ status: "error", message: links.LINK_USED });
  });

  it("a subscription that starts active: its own welcome (a new key), without trial wording, and no trial reminder", async () => {
    // A former subscriber whose welcome went out for the earlier subscription.
    const oldSub = "sub_01hv8x29kz0t586xy6zn1a72aa";
    const [r] = await sql`
      insert into subscribers (email, status, confirmed_at, billing_status, paddle_subscription_id, paddle_customer_id, trial_ends_at, canceled_at, billing_event_at, welcome_sent_at, unsubscribe_token)
      values ('back@example.org', 'confirmed', now() - interval '70 days', 'canceled', ${oldSub}, 'ctm_01hv6y1jedq4p1n0yqn5ba3k72',
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

  it("“Email me my account link” replies before looking the address up: the same reply and no email until after the response", async () => {
    await sql`delete from rate_limits`;
    sent.length = 0;
    await settle();
    const reply = async (email: string, intent = "manage") => actions.accountLinkAction({ status: "idle", message: "" }, form({ email, intent }));
    const known = await reply("paying@example.org");
    const unknown = await reply("nobody-here@example.org", "cancel");
    expect(unknown).toEqual(known);
    expect(known.status).toBe("success");
    // The lookup and the send were handed to after() for both addresses alike: they run after the response.
    expect(afterTasks).toHaveLength(2);
    await settle();
    expect(sent.map((m) => m.to)).toEqual(["paying@example.org"]);
  });

  it("“Cancel my plan” on the unsubscribe page emails the account link worded for cancelling, and opens nothing", async () => {
    await settle();
    await sql`delete from rate_limits`;
    const res = await actions.unsubscribeCancelLinkAction({ status: "idle", message: "" }, form({ token: tok("paying") }));
    expect(res).toEqual({ status: "success", message: "We've emailed you a link to cancel your plan." });
    // Sent after the response (after()), so the reply takes as long either way.
    expect(afterTasks).toHaveLength(1);
    await settle();
    expect(paddleCalls).toHaveLength(0);
    const m = sent.find((x) => x.to === "paying@example.org")!;
    expect(m.subject).toBe("Your link to cancel your Postbird plan");
    expect(m.text).toContain("Cancel plan");
    expect(m.text).toMatch(/\/account\?t=[0-9a-f]{64}/);
    // A malformed token isn't looked up.
    expect(await actions.unsubscribeCancelLinkAction({ status: "idle", message: "" }, form({ token: "bad\u0000token-xxxxxxxxxxxxxx" })))
      .toMatchObject({ status: "error" });
  });
  // ── One trial per person: canonical addresses ──────────────

  it("the database's canonical address matches canonicalTrialEmail, and is kept up to date", async () => {
    const markers = await import("@/lib/billing/trial-markers");
    const samples = ["Name@Example.org", " name+jobs@example.org", "name+a+b@example.org", "first.last@example.org", "First.Last+x@gmail.com",
      "f.i.r.s.t@googlemail.com", "+tag@example.org", "...@gmail.com", "name@mail.gmail.com", "a.b+c@GoogleMail.com"];
    for (const e of samples) {
      const [{ c }] = await sql`select canonical_trial_email(${e}) as c`;
      expect(c).toBe(markers.canonicalTrialEmail(e));
    }
    const [r] = await sql`insert into subscribers (email, status, unsubscribe_token) values ('canon.check+x@gmail.com', 'pending', ${tok("canon-check")}) returning id::int as id, canonical_email`;
    expect(r.canonical_email).toBe("canoncheck@gmail.com");
    await sql`update subscribers set email = 'other.one@example.org' where id = ${r.id}`;
    expect((await sql`select canonical_email from subscribers where id = ${r.id}`)[0].canonical_email).toBe("other.one@example.org");
    await sql`delete from subscribers where id = ${r.id}`;
  });

  it("another form of an address that had a plan gets no trial: the inbox reply, the no-trial terms, and a blocked webhook trial", async () => {
    await sql`
      insert into subscribers (email, status, confirmed_at, billing_status, paddle_subscription_id, trial_ends_at, canceled_at, unsubscribe_token)
      values ('janedoe@gmail.com', 'confirmed', now() - interval '60 days', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a75aa', now() - interval '45 days', now() - interval '50 days', ${tok("janedoe")})`;
    const res = await billing.startCheckout({ email: "Jane.Doe+jobs@googlemail.com", plan: "monthly", search: null });
    expect(res).toMatchObject({ ok: true, inbox: true, email: "jane.doe+jobs@googlemail.com", live: false });
    const id = (res as { subscriberId: number }).subscriberId;
    const [row] = await sql`select canonical_email from subscribers where id = ${id}`;
    expect(row.canonical_email).toBe("janedoe@gmail.com");
    // The emailed link offers the plan without a trial.
    const token = await links.createCheckoutLink(id, { plan: "monthly", search: null });
    expect(await links.findCheckoutLink(token)).toMatchObject({ state: "returning" });
    // A trialing subscription for it (a reference that did allow a trial) is held back and canceled.
    await sql`insert into paddle_checkouts (ref, subscriber_id, plan, trial_allowed) values ('ref-variant-0123456789abcd', ${id}, 'monthly', true)`;
    const sub = "sub_01hv8x29kz0t586xy6zn1a75ab";
    const out = await billing.handlePaddleEvent(subEvent("subscription.created", {
      id: sub, status: "trialing", customer_id: null, custom_data: { ref: "ref-variant-0123456789abcd" },
      billing_cycle: { interval: "month", frequency: 1 }, items: [{ price: { id: PRICE_MONTHLY }, trial_dates: { starts_at: "2026-11-09T10:00:00Z", ends_at: "2026-11-23T10:00:00Z" } }],
    }));
    expect(out).toEqual({ outcome: "flagged", cancel: { subscriptionId: sub, kind: "trial_blocked" } });
    expect((await sql`select kind from billing_flags where subscription_id = ${sub}`)[0].kind).toBe("trial_blocked");

    // A plan at a form of the address that was never confirmed doesn't count.
    await sql`
      insert into subscribers (email, status, billing_status, paddle_subscription_id, canceled_at, unsubscribe_token)
      values ('unconfirmed.sib@gmail.com', 'pending', 'canceled', 'sub_01hv8x29kz0t586xy6zn1a75ac', now() - interval '5 days', ${tok("unconfsib")})`;
    expect(await billing.startCheckout({ email: "unconfirmedsib+x@gmail.com", plan: "monthly", search: null })).toMatchObject({ ok: true, trial: true });
  });

  // ── Trial-marker secret ────────────────────────────────────

  it("without ANALYTICS_SALT or CRON_SECRET no marker is written and the address is kept; the fingerprint shows a mismatch", async () => {
    const markers = await import("@/lib/billing/trial-markers");
    const subscribers = await import("@/lib/subscribers");
    const { secretFingerprint } = await import("@/lib/server-secret");
    await sql`
      insert into subscribers (email, status, confirmed_at, billing_status, canceled_at, unsubscribe_token)
      values ('keep-without-key@example.org', 'unsubscribed', now() - interval '90 days', 'canceled', now() - interval '40 days', ${tok("keep-without-key")})`;
    await sql`update subscribers set unsubscribed_at = now() - interval '40 days', created_at = now() - interval '90 days' where email = 'keep-without-key@example.org'`;
    const salt = process.env.ANALYTICS_SALT;
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(" ")); });
    delete process.env.ANALYTICS_SALT;
    delete process.env.CRON_SECRET;
    try {
      expect(markers.trialMarker("keep-without-key@example.org")).toBeNull();
      expect(await markers.writeTrialMarkers(sql, ["keep-without-key@example.org"])).toBe(false);
      await subscribers.purgeStaleSubscribers();
      expect(await sql`select 1 from subscribers where email = 'keep-without-key@example.org'`).toHaveLength(1);
      expect(errors.some((e) => e.startsWith("::error"))).toBe(true);
      expect(await markers.hasTrialMarker("keep-without-key@example.org")).toBe(false);
      expect(await markers.checkMarkerKey()).toEqual({ status: "missing" });
    } finally {
      spy.mockRestore();
      process.env.ANALYTICS_SALT = salt;
    }
    // With the secret: deleted, marked, and the fingerprint stored for Admin → Overview.
    await subscribers.purgeStaleSubscribers();
    expect(await sql`select 1 from subscribers where email = 'keep-without-key@example.org'`).toHaveLength(0);
    expect(await markers.hasTrialMarker("keep-without-key@example.org")).toBe(true);
    const [fp] = await sql`select value from settings where key = ${markers.MARKER_FINGERPRINT_KEY}`;
    expect(fp.value).toBe(secretFingerprint());
    expect(fp.value).toMatch(/^[0-9a-f]{12}$/);
    expect(await markers.checkMarkerKey()).toEqual({ status: "ok" });
    // The site with a different secret than the scheduled jobs: a warning, and markers don't match.
    process.env.ANALYTICS_SALT = "a-different-salt-on-the-site";
    try {
      expect(await markers.checkMarkerKey()).toMatchObject({ status: "mismatch" });
      expect(await markers.hasTrialMarker("keep-without-key@example.org")).toBe(false);
    } finally {
      process.env.ANALYTICS_SALT = salt;
    }
  });

  it("a marker written before canonical forms existed (normalized address) still counts", async () => {
    const markers = await import("@/lib/billing/trial-markers");
    const { createHmac } = await import("node:crypto");
    const legacy = createHmac("sha256", process.env.ANALYTICS_SALT!).update("trial-marker|old.style+tag@gmail.com").digest("hex");
    await sql`insert into trial_markers (hash, expires_at) values (${legacy}, now() + interval '1 year')`;
    expect(await markers.hasTrialMarker("Old.Style+tag@gmail.com")).toBe(true);
  });

  // ── Daily email quota ──────────────────────────────────────

  it("the daily quota holds under concurrent calls", async () => {
    const { takeDailyQuota } = await import("@/lib/rate-limit");
    // Several rounds: without the lock, calls at the same moment regularly all saw room for one more.
    for (let round = 0; round < 10; round++) {
      const results = await Promise.all(Array.from({ length: 12 }, () => takeDailyQuota(`concurrent-quota|round-${round}@example.org`, 3)));
      expect(results.filter(Boolean)).toHaveLength(3);
    }
    await takeDailyQuota("concurrent-quota|someone@example.org", 3);
    await takeDailyQuota("concurrent-quota|someone@example.org", 3);
    expect(await takeDailyQuota("concurrent-quota|someone@example.org", 3)).toBe(true);
    expect(await takeDailyQuota("concurrent-quota|someone@example.org", 3)).toBe(false);
    expect(await takeDailyQuota("concurrent-quota|someone-else@example.org", 3)).toBe(true);
  });

  // ── Errors shown on Admin → Overview ───────────────────────

  it("a webhook event that fails unexpectedly is recorded once per message, counted, and can be marked as dealt with", async () => {
    const ops = await import("@/lib/ops-events");
    await sql.unsafe(`
      create or replace function test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom for someone@example.org'; end $$;
      drop trigger if exists test_boom on paddle_events;
      create trigger test_boom before insert on paddle_events for each row when (new.event_id like 'evt_boom%') execute function test_boom();`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const n of [1, 2]) {
        const ev = { ...subEvent("subscription.created", { id: "sub_01hv8x29kz0t586xy6zn1a76aa", status: "trialing", customer_id: null, custom_data: null }), event_id: `evt_boom_${n}` };
        expect((await postEvent(ev)).status).toBe(500);
      }
    } finally {
      spy.mockRestore();
      await sql.unsafe("drop trigger if exists test_boom on paddle_events; drop function if exists test_boom();");
    }
    const open = (await ops.openOpsEvents()).filter((o) => o.source === "webhook");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ count: 2 });
    expect(open[0].message).toMatch(/^subscription\.created failed: .*boom/);
    // No address is stored, even when the error quoted one.
    expect(open[0].message).not.toContain("@");
    await ops.resolveOpsEvent(open[0].id);
    expect((await ops.openOpsEvents()).filter((o) => o.source === "webhook")).toHaveLength(0);
  });
  it("the account page's trial and restart buttons go straight to the continue page, with the address's terms", async () => {
    /** The redirect target of a server action (redirect() works by throwing). */
    const redirectOf = async (p: Promise<unknown>) => {
      try { await p; } catch (e) { return String((e as { digest?: string }).digest ?? "").split(";")[2] ?? null; }
      return null;
    };
    const [fresh] = await sql`
      insert into subscribers (email, status, confirmed_at, weekly_email, unsubscribe_token)
      values ('account-trial@example.org', 'confirmed', now(), true, 'unsub-account-trial-xxxxxxxx') returning id::int as id, manage_token`;
    const [had] = await sql`
      insert into subscribers (email, status, confirmed_at, billing_status, paddle_subscription_id, canceled_at, unsubscribe_token)
      values ('account-restart@example.org', 'confirmed', now(), 'canceled', 'sub_01hv8x29kz0t586xy6zn1a7r01', now(), 'unsub-account-restart-xxxxxx') returning id::int as id, manage_token`;
    for (const [r, state] of [[fresh, "new"], [had, "returning"]] as const) {
      const target = await redirectOf(actions.restartPlanAction({ status: "idle", message: "" }, form({ t: r.manage_token })));
      const token = target?.match(/^\/account\/continue\?token=([\w-]+)$/)?.[1];
      expect(token, String(target)).toBeTruthy();
      expect(await links.findCheckoutLink(token)).toMatchObject({ state });
    }
    // No email round trip.
    expect(sent).toHaveLength(0);
    await sql`delete from subscribers where id in (${fresh.id}, ${had.id})`;
  });
});
