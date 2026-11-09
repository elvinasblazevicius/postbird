/**
 * One free trial per email address: the returning-customer rule, the no-trial
 * price and transaction sent to Paddle (fetch is mocked), the other Paddle
 * calls (customer, cancel, billing self-check), and copy and emails that must
 * not promise a trial. No database needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import siteConfig from "@site-config";
import { CHECK_INBOX, checkoutReply } from "@/lib/billing/checkout-links";
import {
  billingSelfCheck, callTimeoutMs, cancelSubscriptionNow, createNoTrialTransaction, createPortalSession, getCustomer, noTrialPrice, noTrialTransactionBody,
  USER_PADDLE_CALL_MS, USER_PADDLE_TOTAL_MS, userPaddleBudget, type PaddlePrice,
} from "@/lib/billing/paddle";
import { hadTrialBefore, welcomeTrialEnd } from "@/lib/billing/subscriptions";
import { canonicalTrialEmail, trialMarker } from "@/lib/billing/trial-markers";
import { secretFingerprint, sharedSecret } from "@/lib/server-secret";
import { noTrialButton, noTrialLine, ONE_TRIAL_RULE, RENEWING, TAX_LINE, trialButton } from "@/lib/early-access-copy";
import { accountLinkEmail, checkoutLinkEmail, welcomeEmail } from "@/lib/email-templates";

/** A confirmed address that never had a plan. */
const NEVER = { confirmed_at: "2026-09-01T00:00:00Z", paddle_subscription_id: null, billing_status: "none" as const, trial_ends_at: null, canceled_at: null, unconfirmed_trial_sub: null };

describe("returning-customer rule", () => {
  it("an address that never had a Paddle subscription is new", () => {
    expect(hadTrialBefore(NEVER)).toBe(false);
  });

  it("any earlier subscription counts, including a trial canceled before it ended", () => {
    expect(hadTrialBefore({ ...NEVER, paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a62ny" })).toBe(true);
    // Trialing, then canceled: each field on its own is enough.
    expect(hadTrialBefore({ ...NEVER, billing_status: "canceled" })).toBe(true);
    expect(hadTrialBefore({ ...NEVER, trial_ends_at: new Date("2026-10-01T00:00:00Z") })).toBe(true);
    expect(hadTrialBefore({ ...NEVER, canceled_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(hadTrialBefore({ ...NEVER, paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a62ny", billing_status: "canceled", trial_ends_at: "2026-10-01T00:00:00Z", canceled_at: "2026-09-25T00:00:00Z" })).toBe(true);
  });

  it("a plan at an address that was never confirmed doesn't count (its owner never proved it)", () => {
    const unconfirmed = { ...NEVER, confirmed_at: null, paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a62ny", billing_status: "canceled" as const, trial_ends_at: "2026-10-01T00:00:00Z", canceled_at: "2026-09-25T00:00:00Z" };
    expect(hadTrialBefore(unconfirmed)).toBe(false);
    // A marker or another form of the address still counts.
    expect(hadTrialBefore(unconfirmed, true)).toBe(true);
  });

  it("a trial canceled because the address wasn't confirmed in time doesn't count, even once confirmed later", () => {
    const sub = "sub_01hv8x29kz0t586xy6zn1a62ny";
    const canceled = { ...NEVER, paddle_subscription_id: sub, billing_status: "canceled" as const, trial_ends_at: "2026-10-01T00:00:00Z", canceled_at: "2026-09-29T00:00:00Z", unconfirmed_trial_sub: sub };
    expect(hadTrialBefore(canceled)).toBe(false);
    // A later subscription at the address counts as usual.
    expect(hadTrialBefore({ ...canceled, paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a62nz" })).toBe(true);
    expect(hadTrialBefore(canceled, true)).toBe(true);
  });

  it("an address whose record was deleted after a plan counts through its trial marker", () => {
    expect(hadTrialBefore(NEVER, true)).toBe(true);
    expect(hadTrialBefore(NEVER, false)).toBe(false);
  });
});

describe("trial markers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are a keyed one-way code of the canonical address, never the address", () => {
    vi.stubEnv("ANALYTICS_SALT", "salt-one");
    const m = trialMarker("someone@example.org");
    expect(m).toMatch(/^[0-9a-f]{64}$/);
    expect(m).not.toContain("someone");
    expect(trialMarker(" Someone@Example.org ")).toBe(m);
    expect(trialMarker("other@example.org")).not.toBe(m);
    // Another secret gives another code (nobody without it can test an address against the table).
    vi.stubEnv("ANALYTICS_SALT", "salt-two");
    expect(trialMarker("someone@example.org")).not.toBe(m);
  });

  it("are the same for every form of one address (+suffix, Gmail dots, googlemail.com)", () => {
    vi.stubEnv("ANALYTICS_SALT", "salt-one");
    expect(trialMarker("Jane.Doe+jobs@googlemail.com")).toBe(trialMarker("janedoe@gmail.com"));
    expect(trialMarker("someone+x@example.org")).toBe(trialMarker("someone@example.org"));
    expect(trialMarker("some.one@example.org")).not.toBe(trialMarker("someone@example.org"));
  });

  it("use ANALYTICS_SALT, else CRON_SECRET, and never a built-in constant", () => {
    vi.stubEnv("ANALYTICS_SALT", "");
    vi.stubEnv("CRON_SECRET", "");
    expect(sharedSecret()).toBeNull();
    expect(trialMarker("someone@example.org")).toBeNull();
    expect(secretFingerprint()).toBeNull();
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    expect(sharedSecret()).toBe("cron-secret-value");
    const viaCron = trialMarker("someone@example.org");
    expect(viaCron).toMatch(/^[0-9a-f]{64}$/);
    vi.stubEnv("ANALYTICS_SALT", "salt-value");
    expect(sharedSecret()).toBe("salt-value");
    expect(trialMarker("someone@example.org")).not.toBe(viaCron);
  });

  it("fingerprints tell two secrets apart without revealing them", () => {
    const a = secretFingerprint("secret-a")!;
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(secretFingerprint("secret-a")).toBe(a);
    expect(secretFingerprint("secret-b")).not.toBe(a);
    expect(a).not.toContain("secret");
  });
});

describe("canonical address for the one-trial rule", () => {
  it.each([
    ["Name@Example.org", "name@example.org"],
    [" name+jobs@example.org ", "name@example.org"],
    ["name+a+b@example.org", "name@example.org"],
    ["first.last@example.org", "first.last@example.org"],
    ["First.Last+x@gmail.com", "firstlast@gmail.com"],
    ["f.i.r.s.t@googlemail.com", "first@gmail.com"],
    ["+tag@example.org", "+tag@example.org"],
    ["...@gmail.com", "...@gmail.com"],
    ["name@mail.gmail.com", "name@mail.gmail.com"],
  ])("%s → %s", (input, out) => {
    expect(canonicalTrialEmail(input)).toBe(out);
  });
});

describe("the trial form's reply", () => {
  it("is the same for an address with a running plan and one that had a plan", () => {
    const live = checkoutReply({ ok: true, inbox: true, email: "a@example.org", subscriberId: 1, live: true }, "monthly");
    const past = checkoutReply({ ok: true, inbox: true, email: "b@example.org", subscriberId: 2, live: false }, "quarterly");
    expect(live).toEqual({ status: "inbox", message: CHECK_INBOX });
    expect(past).toEqual(live);
    expect(CHECK_INBOX).toBe("Check your inbox: we've emailed this address a link to continue.");
    // A new address goes straight to the trial checkout.
    expect(checkoutReply({ ok: true, ref: "r".repeat(32), email: "c@example.org", trial: true }, "quarterly"))
      .toEqual({ status: "ready", message: "", ref: "r".repeat(32), email: "c@example.org", plan: "quarterly", trial: true, transactionId: null, confirmFirst: true });
  });
});

const CATALOG: PaddlePrice = {
  id: "pri_01hv0vax6rv18t4tamj848ne4d",
  product_id: "pro_01hv0vax6rv18t4tamj848ne4e",
  description: "Email alerts, 3 months",
  name: "Every 3 months",
  billing_cycle: { interval: "month", frequency: 3 },
  trial_period: { interval: "day", frequency: 14 },
  tax_mode: "account_setting",
  unit_price: { amount: "1999", currency_code: "USD" },
  unit_price_overrides: [{ country_codes: ["GB"], unit_price: { amount: "1599", currency_code: "GBP" } }],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
};

describe("no-trial price and transaction", () => {
  it("copies the catalog price without its trial", () => {
    expect(noTrialPrice(CATALOG)).toEqual({
      description: "Email alerts, 3 months (no trial: one free trial per email address)",
      name: "Every 3 months",
      product_id: CATALOG.product_id,
      unit_price: { amount: "1999", currency_code: "USD" },
      unit_price_overrides: [{ country_codes: ["GB"], unit_price: { amount: "1599", currency_code: "GBP" } }],
      billing_cycle: { interval: "month", frequency: 3 },
      trial_period: null,
      tax_mode: "account_setting",
      quantity: { minimum: 1, maximum: 1 },
    });
  });

  it("carries the checkout reference as custom_data, the same key Paddle.js passes as customData", () => {
    const body = noTrialTransactionBody(CATALOG, { ref: "r".repeat(32) });
    expect(body).toEqual({ items: [{ quantity: 1, price: noTrialPrice(CATALOG) }], custom_data: { ref: "r".repeat(32) }, collection_mode: "automatic" });
    // No customer or address: a draft that Paddle Checkout completes.
    expect(body).not.toHaveProperty("customer_id");
    expect(body.items[0]).not.toHaveProperty("price_id");
  });

  it("refuses a price that isn't the plan (one-time, archived or without a product)", () => {
    expect(() => noTrialPrice({ ...CATALOG, billing_cycle: null, trial_period: null })).toThrow(/not recurring/);
    expect(() => noTrialPrice({ ...CATALOG, status: "archived" })).toThrow(/not active/);
    expect(() => noTrialPrice({ ...CATALOG, product_id: "" })).toThrow(/no product/);
  });
});

describe("createNoTrialTransaction (Paddle API mocked)", () => {
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  let respond: (url: string, method: string) => Response;

  beforeEach(() => {
    calls.length = 0;
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
    respond = (url, method) => {
      if (method === "GET" && url.endsWith(`/prices/${CATALOG.id}`)) return Response.json({ data: CATALOG });
      if (method === "POST" && url.endsWith("/transactions")) return Response.json({ data: { id: "txn_01hv8wptq8987qeep44cyrewp9", status: "draft" } }, { status: 201 });
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    };
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), method, auth: headers.Authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null });
      return respond(String(url), method);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
  });

  it("reads the catalog price, then creates the transaction with the no-trial copy of it", async () => {
    const id = await createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) });
    expect(id).toBe("txn_01hv8wptq8987qeep44cyrewp9");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET https://sandbox-api.paddle.com/prices/${CATALOG.id}`,
      "POST https://sandbox-api.paddle.com/transactions",
    ]);
    expect(calls.every((c) => c.auth === "Bearer pdl_sdbx_apikey_test_0123456789")).toBe(true);
    expect(calls[1].body).toEqual(noTrialTransactionBody(CATALOG, { ref: "r".repeat(32) }));
    expect(JSON.stringify(calls[1].body)).not.toContain('"trial_period":{');
  });

  it("fails (never falls back) without an API key, when Paddle refuses, or for a bad price id", async () => {
    delete process.env.PADDLE_API_KEY;
    await expect(createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) })).rejects.toThrow(/PADDLE_API_KEY/);
    expect(calls).toHaveLength(0);

    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
    respond = () => Response.json({ error: { code: "forbidden" } }, { status: 403 });
    const err = await createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) }).catch((e: Error) => e);
    expect(String(err)).toContain("HTTP 403 (forbidden)");
    expect(String(err)).not.toContain("apikey");

    await expect(createNoTrialTransaction("pri_bad", { ref: "r".repeat(32) })).rejects.toThrow(/Invalid Paddle price id/);
  });

  it("fails when Paddle returns no transaction id", async () => {
    respond = (url, method) => (method === "GET" ? Response.json({ data: CATALOG }) : Response.json({ data: { id: "oops" } }));
    await expect(createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) })).rejects.toThrow(/no transaction id/);
  });
});

describe("time limits for Paddle calls a visitor waits for (fetch mocked)", () => {
  let signals: AbortSignal[] = [];
  let hang = false;

  beforeEach(() => {
    signals = [];
    hang = false;
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      // A Paddle that never answers: only the time limit ends the call, as with the real fetch.
      if (hang) return new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
      if (String(url).includes("/prices/")) return Response.json({ data: CATALOG });
      if (String(url).endsWith("/portal-sessions")) return Response.json({ data: { urls: { general: { overview: "https://customer-portal.paddle.com/x" }, subscriptions: [] } } });
      return Response.json({ data: { id: "txn_01hv8wptq8987qeep44cyrewp9" } });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
  });

  it("each call gets the smaller of its own limit and what is left of the shared budget", () => {
    const now = 1_000_000;
    expect(USER_PADDLE_CALL_MS).toBeLessThanOrEqual(3000);
    expect(USER_PADDLE_TOTAL_MS).toBeLessThanOrEqual(7000);
    expect(userPaddleBudget(now)).toEqual({ timeoutMs: USER_PADDLE_CALL_MS, deadline: now + USER_PADDLE_TOTAL_MS });
    expect(callTimeoutMs({}, now)).toBe(8000); // the daily job's default
    expect(callTimeoutMs({ timeoutMs: 2500 }, now)).toBe(2500); // the webhook's
    const budget = userPaddleBudget(now);
    expect(callTimeoutMs(budget, now)).toBe(USER_PADDLE_CALL_MS);
    expect(callTimeoutMs(budget, now + USER_PADDLE_TOTAL_MS - 1200)).toBe(1200);
    expect(callTimeoutMs(budget, now + USER_PADDLE_TOTAL_MS + 1)).toBe(0);
  });

  it("a spent budget fails at once, without calling Paddle", async () => {
    const spent = { timeoutMs: USER_PADDLE_CALL_MS, deadline: Date.now() - 1 };
    await expect(createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) }, spent)).rejects.toThrow(/time budget/);
    await expect(createPortalSession("ctm_01hv6y1jedq4p1n0yqn5ba3kd4", null, spent)).rejects.toThrow(/time budget/);
    expect(signals).toHaveLength(0);
  });

  it("both calls of a no-trial checkout share one budget, and a Paddle that doesn't answer is given up on", async () => {
    expect(await createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) }, userPaddleBudget())).toMatch(/^txn_/);
    expect(signals).toHaveLength(2);
    expect(signals.every((sig) => sig instanceof AbortSignal && !sig.aborted)).toBe(true);

    hang = true;
    const t0 = Date.now();
    const err = await createNoTrialTransaction(CATALOG.id, { ref: "r".repeat(32) }, { timeoutMs: 1000, deadline: Date.now() + 120 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(Date.now() - t0).toBeLessThan(800); // the budget (120 ms), not the per-call limit (1 s)
    expect(signals.at(-1)!.aborted).toBe(true);
  });
});

describe("copy and emails for someone who has had a trial", () => {
  const [m, q] = siteConfig.premium.plans;

  it("the line and button say the plan starts today, never a trial", () => {
    expect(noTrialLine("monthly")).toBe(`You've had a free trial before, so your plan starts today: ${m.price} a month, ${RENEWING} until you cancel.`);
    expect(noTrialLine("quarterly")).toBe(`You've had a free trial before, so your plan starts today: ${q.price} every ${q.per}, ${RENEWING} until you cancel.`);
    expect(noTrialLine()).not.toMatch(/\$0|trial ends|trial lasts/);
    expect(noTrialButton).not.toMatch(/trial/i);
    expect(trialButton).toMatch(/trial/i);
    expect(ONE_TRIAL_RULE).toBe("One free trial per email address, counting forms like name+tag@ and dotted Gmail addresses as the same address. If you've had a trial before, your plan starts and is charged straight away.");
  });

  it("the welcome mentions a trial only while the subscription is trialing", () => {
    expect(welcomeTrialEnd("trialing", "2026-11-23T10:00:00Z")).toBe("2026-11-23T10:00:00.000Z");
    // An active-from-start plan whose row still remembers an earlier trial.
    expect(welcomeTrialEnd("active", "2026-10-01T10:00:00Z")).toBeNull();
    expect(welcomeTrialEnd("trialing", null)).toBeNull();
    const w = welcomeEmail({ accountUrl: "https://x.test/account?t=a", unsubscribeUrl: "https://x.test/u", trialEndsAt: welcomeTrialEnd("active", "2026-10-01T10:00:00Z"), plan: "Monthly" });
    expect(w.text).not.toMatch(/trial/i);
    expect(w.html).not.toMatch(/trial/i);
    expect(w.text).toContain("renewing automatically until you cancel");
  });

  it("the free weekly email doesn't offer a trial to an address that had a plan", async () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_client_token");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_PRICE_MONTHLY", "pri_monthly");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_PRICE_QUARTERLY", "pri_quarterly");
    vi.resetModules();
    try {
      const { weeklyEmail } = await import("@/lib/email-templates");
      const group = { label: "Nurse jobs", url: "https://x.test/jobs?q=nurse", jobs: [], total: 3 };
      const links = { trialUrl: "https://x.test/pricing/trial", accountUrl: "https://x.test/account?t=a", unsubscribeUrl: "https://x.test/u" };
      expect(weeklyEmail({ group, search: "q=nurse", ...links }).text).toContain(`Start a ${siteConfig.premium.trialDays}-day free trial`);
      const returning = weeklyEmail({ group, search: "q=nurse", ...links, hadTrial: true });
      expect(returning.text).not.toContain("free trial");
      expect(returning.html).not.toContain("free trial");
      expect(returning.text).toContain("Get daily alerts: https://x.test/pricing/trial");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("Paddle customer, cancel and self-check calls (Paddle API mocked)", () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let respond: (url: string, method: string) => Response;

  beforeEach(() => {
    calls.length = 0;
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
    respond = () => Response.json({ error: { code: "not_found" } }, { status: 404 });
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return respond(String(url), method);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
  });

  it("reads a customer by id, and cancels a subscription at once", async () => {
    respond = (url, method) => {
      if (method === "GET" && url.endsWith("/customers/ctm_01hv6y1jedq4p1n0yqn5ba3ky4")) return Response.json({ data: { id: "ctm_01hv6y1jedq4p1n0yqn5ba3ky4", email: "a@example.org" } });
      if (method === "POST" && url.endsWith("/subscriptions/sub_01hv8x29kz0t586xy6zn1a62ny/cancel")) return Response.json({ data: { id: "sub_01hv8x29kz0t586xy6zn1a62ny" } });
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    };
    expect(await getCustomer("ctm_01hv6y1jedq4p1n0yqn5ba3ky4")).toMatchObject({ email: "a@example.org" });
    await cancelSubscriptionNow("sub_01hv8x29kz0t586xy6zn1a62ny");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://sandbox-api.paddle.com/customers/ctm_01hv6y1jedq4p1n0yqn5ba3ky4",
      "POST https://sandbox-api.paddle.com/subscriptions/sub_01hv8x29kz0t586xy6zn1a62ny/cancel",
    ]);
    expect(calls[1].body).toEqual({ effective_from: "immediately" });
    // Anything that isn't a Paddle id never reaches a URL (an email address least of all).
    await expect(getCustomer("a@example.org")).rejects.toThrow(/Invalid Paddle customer id/);
    await expect(cancelSubscriptionNow("sub_x/../../customers")).rejects.toThrow(/Invalid Paddle subscription id/);
    expect(calls).toHaveLength(2);
  });

  it("the billing self-check says OK, or which permission is missing", async () => {
    const price = "pri_01hv0vax6rv18t4tamj848ne4d";
    respond = (url) => (url.includes("/prices/") ? Response.json({ data: CATALOG }) : Response.json({ data: [] }));
    expect(await billingSelfCheck(price)).toEqual([
      { name: "Price read", ok: true, detail: "OK: the monthly price can be read." },
      { name: "Customer read", ok: true, detail: "OK: customers can be read." },
    ]);
    expect(calls.map((c) => c.url)).toEqual([`https://sandbox-api.paddle.com/prices/${price}`, "https://sandbox-api.paddle.com/customers?per_page=1"]);
    expect(calls.some((c) => c.url.includes("@") || c.url.includes("email"))).toBe(false);

    respond = (url) => (url.includes("/prices/") ? Response.json({ data: CATALOG }) : Response.json({ error: { code: "forbidden" } }, { status: 403 }));
    const missing = await billingSelfCheck(price);
    expect(missing[0].ok).toBe(true);
    expect(missing[1]).toMatchObject({ name: "Customer read", ok: false });
    expect(missing[1].detail).toContain('lacks the "Customer: read" permission');

    respond = () => Response.json({ error: { code: "authentication_malformed" } }, { status: 401 });
    expect((await billingSelfCheck(price)).every((i) => !i.ok && /doesn't accept the API key/.test(i.detail))).toBe(true);

    delete process.env.PADDLE_API_KEY;
    expect(await billingSelfCheck(price)).toEqual([{ name: "API key", ok: false, detail: "PADDLE_API_KEY is not set." }]);
  });
});

describe("emails that lead to a checkout or to billing", () => {
  it("the checkout link email has the single-use link and no trial promise", () => {
    const e = checkoutLinkEmail({ continueUrl: "https://x.test/account/continue?token=" + "t".repeat(32), hours: 24 });
    expect(e.subject).toBe(`Continue to ${siteConfig.name} daily alerts`);
    expect(e.text).toContain("https://x.test/account/continue?token=");
    expect(e.text).toContain("works once and expires in 24 hours");
    expect(e.text).not.toMatch(/free trial/i);
    expect(e.text).toContain("Nueva Nova LLC");
  });

  it("the account link email is worded for its purpose", () => {
    const links = { accountUrl: "https://x.test/account?t=" + "a".repeat(64), unsubscribeUrl: "https://x.test/u" };
    expect(accountLinkEmail(links).subject).toBe(`Your ${siteConfig.name} account link`);
    const cancel = accountLinkEmail({ ...links, purpose: "cancel" });
    expect(cancel.subject).toBe(`Your link to cancel your ${siteConfig.name} plan`);
    expect(cancel.text).toContain("Cancel plan");
    const already = accountLinkEmail({ ...links, purpose: "already" });
    expect(already.subject).toBe(`You already have ${siteConfig.name} daily alerts`);
    expect(already.text).toContain(links.accountUrl);
  });

  it("tax wording is true whichever tax mode Paddle uses", () => {
    expect(TAX_LINE).toBe("Prices in US dollars. Depending on where you live, VAT or sales tax is included or added; Paddle shows the exact total before you pay.");
  });
});
