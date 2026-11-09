/** Paid alerts: Paddle webhook signatures, subscription state mapping, copy and saved-search parsing. No database needed. */
import { describe, expect, it } from "vitest";
import siteConfig from "@site-config";
import { parseSignatureHeader, signPayload, verifyPaddleSignature, paddleApiBase } from "@/lib/billing/paddle";
import { billingFromSubscription, transitionEffects } from "@/lib/billing/subscriptions";
import type { PaddleSubscription } from "@/lib/billing/paddle";
import { planDescription, planOptions, planPriceNumber, trialButton, trialLine } from "@/lib/early-access-copy";
import { normalizeSearch } from "@/lib/saved-searches";

const SECRET = "pdl_ntfset_01gkpjp8bkm3tm53kdgkx6sms7_testsecret";
const BODY = '{"event_id":"evt_01","event_type":"subscription.created","occurred_at":"2026-11-09T10:00:00Z","data":{"id":"sub_x"}}';
const NOW = 1_762_682_400;
const header = (ts: number, body = BODY, secret = SECRET) => `ts=${ts};h1=${signPayload(body, ts, secret)}`;

describe("Paddle webhook signature", () => {
  it("accepts a valid signature", () => {
    expect(verifyPaddleSignature(BODY, header(NOW), SECRET, NOW)).toEqual({ ok: true });
    expect(verifyPaddleSignature(BODY, header(NOW - 30), SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects a tampered body or a signature made with another secret", () => {
    expect(verifyPaddleSignature(BODY.replace("sub_x", "sub_y"), header(NOW), SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyPaddleSignature(BODY, header(NOW, BODY, "other-secret"), SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
    // Changing the timestamp in the header breaks the signature too.
    const h = header(NOW).replace(`ts=${NOW}`, `ts=${NOW - 1}`);
    expect(verifyPaddleSignature(BODY, h, SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects old (replayed) and far-future timestamps", () => {
    expect(verifyPaddleSignature(BODY, header(NOW - 3600), SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(verifyPaddleSignature(BODY, header(NOW + 3600), SECRET, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects missing or malformed headers and a missing secret", () => {
    expect(verifyPaddleSignature(BODY, null, SECRET, NOW).ok).toBe(false);
    expect(verifyPaddleSignature(BODY, "garbage", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyPaddleSignature(BODY, `ts=${NOW};h1=xyz`, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyPaddleSignature(BODY, header(NOW), "", NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it("accepts any of several h1 values (secret rotation)", () => {
    const good = signPayload(BODY, NOW, SECRET);
    const h = `ts=${NOW};h1=${"0".repeat(64)};h1=${good}`;
    expect(parseSignatureHeader(h)?.h1).toHaveLength(2);
    expect(verifyPaddleSignature(BODY, h, SECRET, NOW)).toEqual({ ok: true });
  });

  it("uses the sandbox API unless the environment is production", () => {
    expect(paddleApiBase("sandbox")).toBe("https://sandbox-api.paddle.com");
    expect(paddleApiBase("production")).toBe("https://api.paddle.com");
  });
});

const prices = { monthly: "pri_monthly000000000000000000", quarterly: "pri_quarterly0000000000000000" };

function sub(over: Partial<PaddleSubscription> = {}): PaddleSubscription {
  return {
    id: "sub_01hv8x29kz0t586xy6zn1a62ny",
    status: "trialing",
    customer_id: "ctm_01hv6y1jedq4p1n0yqn5ba3ky4",
    custom_data: { ref: "abc" },
    billing_cycle: { interval: "month", frequency: 3 },
    current_billing_period: { starts_at: "2026-11-09T10:00:00Z", ends_at: "2026-11-23T10:00:00Z" },
    next_billed_at: "2026-11-23T10:00:00Z",
    canceled_at: null,
    scheduled_change: null,
    items: [{ price: { id: prices.quarterly }, trial_dates: { starts_at: "2026-11-09T10:00:00Z", ends_at: "2026-11-23T10:00:00Z" } }],
    ...over,
  };
}

describe("subscription state", () => {
  it("maps a trialing subscription", () => {
    expect(billingFromSubscription(sub(), prices)).toEqual({
      status: "trialing", planInterval: "quarter", trialEndsAt: "2026-11-23T10:00:00Z",
      currentPeriodEnd: "2026-11-23T10:00:00Z", canceledAt: null, cancelAt: null,
    });
  });

  it("recognises the plan by price id, else by billing cycle", () => {
    expect(billingFromSubscription(sub({ items: [{ price: { id: prices.monthly } }] }), prices).planInterval).toBe("month");
    expect(billingFromSubscription(sub({ items: [], billing_cycle: { interval: "month", frequency: 1 } }), prices).planInterval).toBe("month");
    expect(billingFromSubscription(sub({ items: [], billing_cycle: { interval: "year", frequency: 1 } }), prices).planInterval).toBeNull();
  });

  it("records a cancellation scheduled for the end of the trial", () => {
    const b = billingFromSubscription(sub({ scheduled_change: { action: "cancel", effective_at: "2026-11-23T10:00:00Z" } }), prices);
    expect(b.status).toBe("trialing");
    expect(b.cancelAt).toBe("2026-11-23T10:00:00Z");
  });

  it("maps active, past_due, paused and canceled; unknown statuses become 'none'", () => {
    const active = billingFromSubscription(sub({ status: "active", items: [{ price: { id: prices.quarterly } }], current_billing_period: { starts_at: "2026-11-23T10:00:00Z", ends_at: "2027-02-23T10:00:00Z" } }), prices);
    expect(active).toMatchObject({ status: "active", currentPeriodEnd: "2027-02-23T10:00:00Z", trialEndsAt: null });
    expect(billingFromSubscription(sub({ status: "past_due" }), prices).status).toBe("past_due");
    expect(billingFromSubscription(sub({ status: "paused" }), prices).status).toBe("paused");
    const canceled = billingFromSubscription(sub({ status: "canceled", canceled_at: "2026-11-20T00:00:00Z", current_billing_period: null, next_billed_at: null }), prices);
    expect(canceled).toMatchObject({ status: "canceled", canceledAt: "2026-11-20T00:00:00Z", currentPeriodEnd: null });
    expect(billingFromSubscription(sub({ status: "something_new" }), prices).status).toBe("none");
  });

  it("starts the trial, sends the welcome and counts a cancellation exactly once", () => {
    const fresh = { subscriptionId: null, status: "none" as const, welcomeSent: false };
    expect(transitionEffects(fresh, { subscriptionId: "sub_a", status: "trialing" })).toEqual({ trialStarted: true, canceled: false, sendWelcome: true });
    // The same trial again (subscription.trialing after subscription.created).
    expect(transitionEffects({ subscriptionId: "sub_a", status: "trialing", welcomeSent: true }, { subscriptionId: "sub_a", status: "trialing" }))
      .toEqual({ trialStarted: false, canceled: false, sendWelcome: false });
    // Trial converts to paying: no new trial, no second welcome.
    expect(transitionEffects({ subscriptionId: "sub_a", status: "trialing", welcomeSent: true }, { subscriptionId: "sub_a", status: "active" }))
      .toEqual({ trialStarted: false, canceled: false, sendWelcome: false });
    expect(transitionEffects({ subscriptionId: "sub_a", status: "active", welcomeSent: true }, { subscriptionId: "sub_a", status: "canceled" }).canceled).toBe(true);
    expect(transitionEffects({ subscriptionId: "sub_a", status: "canceled", welcomeSent: true }, { subscriptionId: "sub_a", status: "canceled" }).canceled).toBe(false);
    // Past due or paused don't trigger a welcome.
    expect(transitionEffects(fresh, { subscriptionId: "sub_a", status: "past_due" }).sendWelcome).toBe(false);
  });
});

describe("paid-alert copy", () => {
  const [m, q] = siteConfig.premium.plans;

  it("builds the trial button and line from site.config.ts", () => {
    expect(trialButton).toBe(`Start ${siteConfig.premium.trialDays}-day free trial`);
    expect(trialLine()).toBe(
      `Card required. $0 today, then ${m.price}/${m.per} or ${q.price} every ${q.per} unless you cancel before day ${siteConfig.premium.trialDays}. Cancel any time.`,
    );
    expect(trialLine()).not.toMatch(/\$\d+\.\d\d\/3 months/);
  });

  it("offers the 3-month plan first, with its monthly equivalent", () => {
    const opts = planOptions();
    expect(opts.map((o) => o.value)).toEqual(["quarterly", "monthly"]);
    expect(opts[0].detail).toContain("/month");
    expect(planDescription("month")).toContain(m.price);
    expect(planDescription("quarter")).toContain(q.price);
    expect(planPriceNumber("month")).toBe(Number(m.price.replace("$", "")));
  });
});

describe("saved searches", () => {
  it("keeps only valid filters in a fixed order", () => {
    expect(normalizeSearch("remote=1&q=data+analyst&bogus=1&page=3&sort=deadline&posted=7")).toBe("q=data+analyst&remote=1");
    expect(normalizeSearch("")).toBe("");
  });

  it("accepts a pasted /jobs link and rejects other links", () => {
    expect(normalizeSearch("https://postbird.nuevanova.com/jobs?category=health&q=nurse")).toBe("q=nurse&category=health");
    expect(normalizeSearch("/jobs")).toBe("");
    expect(normalizeSearch("https://example.com/about?q=x")).toBeNull();
    expect(normalizeSearch("q=<script>")).toBeNull();
  });
});
