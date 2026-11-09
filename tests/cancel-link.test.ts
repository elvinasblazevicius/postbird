/**
 * "Cancel plan" on the account page: createCancelSession asks Paddle for a portal session for the
 * subscription and returns its cancel deep link (or the overview when Paddle gives none), after
 * checking both ids; cancelPlanAction checks the account link, the plan, the API key, the rate
 * limit and the Paddle customer before anything is opened. Paddle's API is a stubbed fetch; the
 * account lookup, rate limit and customer check are mocked. No database needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CUSTOMER = "ctm_01hv6y1jedq4p1n0yqn5ba3kd4";
const SUB = "sub_01hv8x29kz0t586xy6zn1a62ny";
const OTHER_SUB = "sub_01hv8x29kz0t586xy6zn1a62nz";
const OVERVIEW = "https://customer-portal.paddle.com/cpl_01/overview";
const CANCEL = `https://customer-portal.paddle.com/cpl_01/subscriptions/${SUB}/cancel`;

const mocks = vi.hoisted(() => ({
  account: null as null | { paddle_subscription_id: string | null },
  lookupFails: false,
  limit: "ok" as "ok" | "limited" | "error",
  customer: "ctm_01hv6y1jedq4p1n0yqn5ba3kd4" as string | null,
  redirectedTo: null as string | null,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { mocks.redirectedTo = url; throw new Error("NEXT_REDIRECT"); },
}));
vi.mock("@/lib/account", () => ({
  findByManageToken: async () => { if (mocks.lookupFails) throw new Error("db down"); return mocks.account; },
}));
vi.mock("@/lib/billing/subscriptions", () => ({ verifiedCustomerFor: async () => mocks.customer }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "203.0.113.9", safeRateLimit: async () => mocks.limit }));

type Call = { url: string; method: string; body: unknown };

describe("cancel deep link", () => {
  const calls: Call[] = [];
  let reply: () => Response;

  beforeEach(() => {
    calls.length = 0;
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
    mocks.account = { paddle_subscription_id: SUB };
    mocks.lookupFails = false;
    mocks.limit = "ok";
    mocks.customer = CUSTOMER;
    mocks.redirectedTo = null;
    reply = () => Response.json({ data: { urls: { general: { overview: OVERVIEW }, subscriptions: [{ id: SUB, cancel_subscription: CANCEL }] } } });
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PADDLE_API_KEY;
  });

  describe("createCancelSession", () => {
    it("asks for a portal session for this one subscription and returns its cancel link", async () => {
      const { createCancelSession } = await import("@/lib/billing/paddle");
      expect(await createCancelSession(CUSTOMER, SUB)).toBe(CANCEL);
      expect(calls).toEqual([{ url: `https://sandbox-api.paddle.com/customers/${CUSTOMER}/portal-sessions`, method: "POST", body: { subscription_ids: [SUB] } }]);
    });

    it("falls back to the portal overview when Paddle gives no cancel link for the subscription", async () => {
      const { createCancelSession } = await import("@/lib/billing/paddle");
      reply = () => Response.json({ data: { urls: { general: { overview: OVERVIEW }, subscriptions: [{ id: SUB }] } } });
      expect(await createCancelSession(CUSTOMER, SUB)).toBe(OVERVIEW);
      // Another subscription's cancel link is never used.
      reply = () => Response.json({ data: { urls: { general: { overview: OVERVIEW }, subscriptions: [{ id: OTHER_SUB, cancel_subscription: "https://customer-portal.paddle.com/other/cancel" }] } } });
      expect(await createCancelSession(CUSTOMER, SUB)).toBe(OVERVIEW);
    });

    it("checks both ids before calling Paddle", async () => {
      const { createCancelSession } = await import("@/lib/billing/paddle");
      await expect(createCancelSession("ctm_short", SUB)).rejects.toThrow("Invalid Paddle customer id");
      await expect(createCancelSession(`${CUSTOMER}/../x`, SUB)).rejects.toThrow("Invalid Paddle customer id");
      await expect(createCancelSession(CUSTOMER, "sub_NOTLOWERCASE0000000000000000")).rejects.toThrow("Invalid Paddle subscription id");
      await expect(createCancelSession(CUSTOMER, "pri_01hv8x29kz0t586xy6zn1a62ny")).rejects.toThrow("Invalid Paddle subscription id");
      expect(calls).toEqual([]);
    });

    it("an error from Paddle carries the status and code only", async () => {
      const { createCancelSession } = await import("@/lib/billing/paddle");
      reply = () => Response.json({ error: { code: "forbidden" } }, { status: 403 });
      await expect(createCancelSession(CUSTOMER, SUB)).rejects.toThrow("Paddle API returned HTTP 403 (forbidden)");
    });
  });

  describe("cancelPlanAction", () => {
    const form = (t = "a".repeat(64)) => { const f = new FormData(); f.set("t", t); return f; };
    const run = async (f = form()) => {
      const { cancelPlanAction } = await import("@/app/cancel-actions");
      try {
        return await cancelPlanAction({ status: "idle" } as never, f);
      } catch (e) {
        if ((e as Error).message === "NEXT_REDIRECT") return "redirected";
        throw e;
      }
    };

    it("opens Paddle's cancel page for the subscription", async () => {
      expect(await run()).toBe("redirected");
      expect(mocks.redirectedTo).toBe(CANCEL);
      expect(calls).toHaveLength(1);
    });

    it("opens the overview when Paddle gives no cancel link", async () => {
      reply = () => Response.json({ data: { urls: { general: { overview: OVERVIEW }, subscriptions: [] } } });
      expect(await run()).toBe("redirected");
      expect(mocks.redirectedTo).toBe(OVERVIEW);
    });

    it("stops before Paddle: invalid link, no plan, no API key, rate limit, unverified customer", async () => {
      mocks.account = null;
      expect(await run()).toEqual({ status: "error", message: "This account link isn't valid any more. Ask for a new one below." });
      mocks.account = { paddle_subscription_id: null };
      expect(await run()).toEqual({ status: "error", message: "There's no plan to cancel for this address." });
      mocks.account = { paddle_subscription_id: SUB };
      delete process.env.PADDLE_API_KEY;
      expect(await run()).toMatchObject({ status: "error", message: expect.stringContaining("Billing management isn't available") });
      process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
      mocks.limit = "limited";
      expect(await run()).toEqual({ status: "error", message: "Too many attempts. Please try again later." });
      mocks.limit = "error";
      expect(await run()).toMatchObject({ status: "error", message: expect.stringContaining("try again in a minute") });
      mocks.limit = "ok";
      mocks.customer = null;
      expect(await run()).toMatchObject({ status: "error", message: expect.stringContaining("We couldn't open billing for this address") });
      mocks.lookupFails = true;
      expect(await run()).toEqual({ status: "error", message: "Something went wrong on our side. Please try again in a minute." });
      expect(calls).toEqual([]);
      expect(mocks.redirectedTo).toBeNull();
    });

    it("a failed Paddle call asks to try again and redirects nowhere", async () => {
      reply = () => Response.json({ error: { code: "internal_error" } }, { status: 500 });
      expect(await run()).toEqual({ status: "error", message: "We couldn't open billing just now. Please try again in a minute." });
      expect(mocks.redirectedTo).toBeNull();
    });
  });
});
