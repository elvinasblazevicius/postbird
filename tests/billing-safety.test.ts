/**
 * Billing safety and consent, without a database: the confirmation email for
 * a trial at an unconfirmed address, the checkout copy, Paddle call time
 * limits, the rate-limit wrapper that fails closed, the capped /api/track
 * body, alert idempotency keys, clearing ad storage after "No thanks", the
 * consent regions, and the homepage wording without the EU.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { adCookieNames, adStorageKeys, clearAdStorage, expireCookieStrings } from "@/lib/ad-storage";
import { confirmDeadline, planPeriod, planPrice } from "@/lib/billing/notices";
import { cancelSubscriptionNow, getCustomer, getSubscription, WEBHOOK_PADDLE_TIMEOUT_MS } from "@/lib/billing/paddle";
import { alertKey } from "@/lib/digest";
import {
  CONFIRM_FIRST_DONE, CONFIRM_WITHIN_DAYS, NO_TRIAL_RENEWAL_ACK, TRIAL_RENEWAL_ACK, UNCONFIRMED_CANCEL_DAYS,
} from "@/lib/early-access-copy";
import { paidConfirmationEmail } from "@/lib/email-templates";
import { employersPhrase, homeCopy } from "@/lib/eu-claim";
import { safeRateLimit } from "@/lib/rate-limit";
import { GET as geo } from "@/app/api/geo/route";
import { POST as track } from "@/app/api/track/route";

describe("confirmation email for a trial started at an unconfirmed address", () => {
  const base = { confirmUrl: "https://site.test/alerts/confirm?token=abc", accountUrl: "https://site.test/account?t=" + "a".repeat(64), price: "$19.99", period: "every 3 months" };

  it("tells the buyer the trial, the price, the deadline and how to cancel", () => {
    const trialEndsAt = "2026-11-23T10:00:00.000Z";
    const m = paidConfirmationEmail({ ...base, trialEndsAt, confirmBy: confirmDeadline(trialEndsAt) });
    expect(m.subject).toBe("Confirm your email for Postbird alerts");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("You started a 14-day free trial of Postbird daily alerts. Confirm this address to start your alerts.");
      expect(body).toContain("Your trial ends on 23 Nov 2026; then $19.99 every 3 months, renewing automatically until you cancel.");
      expect(body).toContain("21 Nov 2026, we cancel the trial and nothing is charged.");
      expect(body).toContain("Nueva Nova LLC");
    }
    expect(m.text).toContain("Didn't start this? Ignore this email and nothing will be charged.");
    expect(m.text).toContain(`Confirm: ${base.confirmUrl}`);
    expect(m.text).toContain(`Your account: ${base.accountUrl}`);
    expect(m.html).toContain(base.accountUrl);
  });

  it("without a trial it never mentions one", () => {
    const m = paidConfirmationEmail({ ...base, trialEndsAt: null, confirmBy: null });
    expect(m.text).not.toMatch(/trial/i);
    expect(m.text).toContain("The plan costs $19.99 every 3 months, renewing automatically until you cancel.");
    expect(m.text).toContain("reply to this email");
  });

  it("the deadline is 2 days before the trial ends, and the copy matches it", () => {
    expect(UNCONFIRMED_CANCEL_DAYS).toBe(2);
    expect(confirmDeadline("2026-11-23T10:00:00.000Z")).toBe("2026-11-21T10:00:00.000Z");
    expect(CONFIRM_WITHIN_DAYS).toBe(12);
    expect(CONFIRM_FIRST_DONE).toBe("Confirm your address within 12 days to start your alerts; if you don't, we cancel the trial and you pay nothing.");
    expect(planPrice("month")).toBe("$9.99");
    expect(planPeriod("month")).toBe("per month");
    expect(planPeriod("quarter")).toBe("every 3 months");
  });
});

describe("checkout consent copy", () => {
  it("has a renewal checkbox for each kind of checkout whose label is the consent (no separate consent sentence)", () => {
    expect(TRIAL_RENEWAL_ACK).toBe("I agree that my plan renews automatically after the trial until I cancel.");
    expect(NO_TRIAL_RENEWAL_ACK).toBe("I agree that my plan renews automatically until I cancel.");
    expect(NO_TRIAL_RENEWAL_ACK).not.toMatch(/trial/i);
  });
});

describe("Paddle calls from the webhook give up early", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PADDLE_API_KEY;
  });

  it("passes timeoutMs to the request (default 8 seconds)", async () => {
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_test_0123456789";
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return real(ms);
    });
    vi.stubGlobal("fetch", async () => Response.json({ data: { id: "x", email: "a@example.org", status: "active" } }));
    expect(WEBHOOK_PADDLE_TIMEOUT_MS).toBe(2500);
    await getCustomer("ctm_01hv6y1jedq4p1n0yqn5ba3ky4", { timeoutMs: WEBHOOK_PADDLE_TIMEOUT_MS });
    await getSubscription("sub_01hv8x29kz0t586xy6zn1a62ny", { timeoutMs: WEBHOOK_PADDLE_TIMEOUT_MS });
    await cancelSubscriptionNow("sub_01hv8x29kz0t586xy6zn1a62ny", { timeoutMs: WEBHOOK_PADDLE_TIMEOUT_MS });
    await getCustomer("ctm_01hv6y1jedq4p1n0yqn5ba3ky4");
    expect(timeouts).toEqual([2500, 2500, 2500, 8000]);
  });
});

describe("safeRateLimit", () => {
  it("answers \"error\" instead of throwing when the database can't be asked", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await safeRateLimit("signup:203.0.113.9", 8, 3600)).toBe("error");
    } finally {
      errors.mockRestore();
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});

describe("/api/track", () => {
  it("refuses a body over 4000 bytes without reading it all", async () => {
    const big = JSON.stringify({ type: "pageview", path: "/", props: { pad: "x".repeat(5000) } });
    const res = await track(new Request("http://localhost/api/track", { method: "POST", body: big, headers: { "user-agent": "Mozilla/5.0 test" } }));
    expect(res.status).toBe(413);
  });
});

describe("paid alert idempotency keys", () => {
  it("come from the subscriber and each search's window, in any order", () => {
    const a = alertKey(7, [{ id: 2, last_sent_at: "2026-11-08T06:23:00Z" }, { id: 1, last_sent_at: null }]);
    expect(a).toBe(alertKey(7, [{ id: 1, last_sent_at: null }, { id: 2, last_sent_at: new Date("2026-11-08T06:23:00Z") }]));
    expect(a).toMatch(/^alert:7:[0-9a-f]{32}$/);
    expect(a).not.toBe(alertKey(7, [{ id: 2, last_sent_at: "2026-11-09T06:23:00Z" }, { id: 1, last_sent_at: null }]));
    expect(a).not.toBe(alertKey(8, [{ id: 2, last_sent_at: "2026-11-08T06:23:00Z" }, { id: 1, last_sent_at: null }]));
  });
});

describe("No thanks to advertising cookies", () => {
  it("finds the ad cookies and storage entries, and expires the cookies on every parent domain", () => {
    expect(adCookieNames("_uetsid=a; theme=dark; _uetvid=b; MUID=c; _uetmsclkid=d; gch_x=1")).toEqual(["_uetsid", "_uetvid", "MUID", "_uetmsclkid"]);
    expect(adStorageKeys(["_uetsid", "_uetsid_exp", "_uetvid_exp", "_uetmsclkid", "MUID", "gch_attr", "gch_ads_consent", "gch_geo", "saved_jobs"]))
      .toEqual(["_uetsid", "_uetsid_exp", "_uetvid_exp", "_uetmsclkid", "MUID", "gch_attr"]);
    const strings = expireCookieStrings("_uetsid", "postbird.nuevanova.com");
    expect(strings).toHaveLength(3);
    expect(strings[0]).toMatch(/^_uetsid=; Max-Age=0; .*Path=\/$/);
    expect(strings.slice(1).map((s) => s.split("Domain=")[1])).toEqual([".postbird.nuevanova.com", ".nuevanova.com"]);
    expect(expireCookieStrings("MUID", "localhost")).toHaveLength(1);
    expect(expireCookieStrings("MUID", "127.0.0.1")).toHaveLength(1);
  });

  it("clears cookies and both storages, keeping the consent choice", () => {
    const written: string[] = [];
    const doc = {
      get cookie() { return "_uetsid=a; _uetvid=b; other=1"; },
      set cookie(v: string) { written.push(v); },
    };
    const store = (keys: string[]) => {
      const m = new Map(keys.map((k) => [k, "1"]));
      return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] };
    };
    const local = store(["_uetsid", "_uetsid_exp", "_uetvid", "gch_attr", "gch_ads_consent"]);
    const session = store(["_uetsid", "gch_geo"]);
    clearAdStorage({ doc, hostname: "www.example.org", stores: [local, session, null] });
    expect(written.filter((w) => w.startsWith("_uetsid="))).toHaveLength(3);
    expect(written.filter((w) => w.startsWith("_uetvid="))).toHaveLength(3);
    expect(written.some((w) => w.startsWith("other="))).toBe(false);
    expect(local.keys()).toEqual(["gch_ads_consent"]);
    expect(session.keys()).toEqual(["gch_geo"]);
  });
});

describe("/api/geo consent regions", () => {
  const call = async (headers: Record<string, string>) => (await geo(new Request("http://localhost/api/geo", { headers })).json()) as { country: string | null; consentRequired: boolean };
  const nf = (geoJson: object) => ({ "x-nf-geo": Buffer.from(JSON.stringify(geoJson)).toString("base64") });

  it("asks first everywhere except the United States", async () => {
    for (const c of ["TR", "KR", "BR", "DE", "GB", "IN", "JP", "AU", "KE", "MX", "CA"]) expect(await call({ "x-vercel-ip-country": c })).toEqual({ country: c, consentRequired: true });
    expect(await call({ "x-vercel-ip-country": "US" })).toEqual({ country: "US", consentRequired: false });
    expect(await call(nf({ country: { code: "US" }, subdivision: { code: "CA", name: "California" } }))).toEqual({ country: "US", consentRequired: false });
    expect(await call(nf({ country: { code: "CA" }, subdivision: { code: "ON", name: "Ontario" } }))).toEqual({ country: "CA", consentRequired: true });
  });

  it("asks first when the country is unknown", async () => {
    expect(await call({})).toEqual({ country: null, consentRequired: true });
    for (const c of ["XX", "T1", "", "usa"]) expect((await call({ "cf-ipcountry": c })).consentRequired).toBe(true);
  });
});

describe("homepage wording without EU listings", () => {
  it("names the EU only when asked to", () => {
    const withEu = homeCopy(true);
    expect(withEu.headline).toMatch(/\bEU\b/);
    const without = homeCopy(false);
    for (const line of Object.values(without)) expect(line).not.toMatch(/\bEU\b/);
    expect(without.tagline).toBe("UN and international organization jobs in one place");
    expect(employersPhrase(false)).toBe("UN and international organization");
    expect(employersPhrase(true)).toBe("UN, EU and international organization");
  });
});
