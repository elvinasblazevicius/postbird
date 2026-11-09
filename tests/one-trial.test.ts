/**
 * One free trial per person: the returning-customer rule, the no-trial price
 * and transaction sent to Paddle (fetch is mocked), and copy and emails that
 * must not promise a trial. No database needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import siteConfig from "@site-config";
import { createNoTrialTransaction, noTrialPrice, noTrialTransactionBody, type PaddlePrice } from "@/lib/billing/paddle";
import { hadTrialBefore, welcomeTrialEnd } from "@/lib/billing/subscriptions";
import { noTrialButton, noTrialLine, ONE_TRIAL_RULE, RENEWING, trialButton } from "@/lib/early-access-copy";
import { welcomeEmail } from "@/lib/email-templates";

const NEVER = { paddle_subscription_id: null, billing_status: "none" as const, trial_ends_at: null, canceled_at: null };

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
    expect(hadTrialBefore({ paddle_subscription_id: "sub_01hv8x29kz0t586xy6zn1a62ny", billing_status: "canceled", trial_ends_at: "2026-10-01T00:00:00Z", canceled_at: "2026-09-25T00:00:00Z" })).toBe(true);
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
      description: "Email alerts, 3 months (no trial: one free trial per person)",
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

describe("copy and emails for someone who has had a trial", () => {
  const [m, q] = siteConfig.premium.plans;

  it("the line and button say the plan starts today, never a trial", () => {
    expect(noTrialLine("monthly")).toBe(`You've had a free trial before, so your plan starts today: ${m.price} a month, ${RENEWING} until you cancel.`);
    expect(noTrialLine("quarterly")).toBe(`You've had a free trial before, so your plan starts today: ${q.price} every ${q.per}, ${RENEWING} until you cancel.`);
    expect(noTrialLine()).not.toMatch(/\$0|trial ends|trial lasts/);
    expect(noTrialButton).not.toMatch(/trial/i);
    expect(trialButton).toMatch(/trial/i);
    expect(ONE_TRIAL_RULE).toBe("One free trial per person. If you've had a trial before, your plan starts and is charged straight away.");
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
