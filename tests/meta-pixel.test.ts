/**
 * Meta Pixel: off without an ID, loads once with privacy settings first, sends only allowed
 * parameters, and sends nothing without advertising consent (src/lib/meta-pixel.ts,
 * adConversion/metaEvent in src/components/ads.tsx).
 */
import { afterEach, describe, expect, it } from "vitest";
import { adStorageKeys, adCookieNames } from "@/lib/ad-storage";
import { cleanParams, loadMetaPixel, META_PIXEL_ID, META_PIXEL_SCRIPT_ID, META_PIXEL_SRC, metaConsent, metaTrack, parsePixelId, type PixelEnv } from "@/lib/meta-pixel";

function fakeEnv() {
  const els = new Map<string, { id: string; async: boolean; src: string }>();
  const appended: { id: string; async: boolean; src: string }[] = [];
  const win: PixelEnv["win"] = {};
  const env: PixelEnv = {
    win,
    doc: {
      getElementById: (id: string) => els.get(id) ?? null,
      createElement: () => ({ id: "", async: false, src: "" }),
      head: {
        appendChild: (el: never) => {
          const e = el as { id: string; async: boolean; src: string };
          appended.push(e);
          els.set(e.id, e);
          return el;
        },
      },
    },
  };
  const calls = () => (win.fbq ? win.fbq.queue : []);
  return { env, win, appended, calls };
}

describe("Meta Pixel", () => {
  it("is off without a valid Pixel ID (unset in tests, as locally)", () => {
    expect(META_PIXEL_ID).toBeNull();
    expect(parsePixelId(undefined)).toBeNull();
    expect(parsePixelId("")).toBeNull();
    expect(parsePixelId("  ")).toBeNull();
    expect(parsePixelId("your-pixel-id")).toBeNull();
    expect(parsePixelId("123<script>")).toBeNull();
    expect(parsePixelId(" 678690642892717 ")).toBe("678690642892717");

    const f = fakeEnv();
    expect(loadMetaPixel(f.env, null)).toBe(false);
    expect(loadMetaPixel(f.env, "")).toBe(false);
    expect(f.appended).toHaveLength(0);
    expect(f.win.fbq).toBeUndefined();
  });

  it("sends nothing before it is loaded", () => {
    const f = fakeEnv();
    expect(metaTrack(f.env, "Lead")).toBe(false);
    metaConsent(f.env, true);
    expect(f.win.fbq).toBeUndefined();
  });

  it("loads once: consent, autoConfig off, init without customer data, then one PageView", () => {
    const f = fakeEnv();
    expect(loadMetaPixel(f.env, "678690642892717")).toBe(true);
    expect(f.appended).toEqual([{ id: META_PIXEL_SCRIPT_ID, async: true, src: META_PIXEL_SRC }]);
    expect(META_PIXEL_SRC).toBe("https://connect.facebook.net/en_US/fbevents.js");
    expect(f.calls()).toEqual([
      ["consent", "grant"],
      ["set", "autoConfig", false, "678690642892717"],
      ["init", "678690642892717"],
      ["track", "PageView"],
    ]);
    // The pixel's own History API page views are off (AdsManager reports in-site pages).
    expect(f.win.fbq?.disablePushState).toBe(true);

    // A second load (e.g. "Allow" clicked again) neither adds a script nor counts the page twice.
    expect(loadMetaPixel(f.env, "678690642892717")).toBe(false);
    expect(f.appended).toHaveLength(1);
    expect(f.calls().filter((c) => c[0] === "track" && c[1] === "PageView")).toHaveLength(1);
  });

  it("sends only a value and currency with events", () => {
    const f = fakeEnv();
    loadMetaPixel(f.env, "678690642892717");
    const before = f.calls().length;
    metaTrack(f.env, "Lead");
    metaTrack(f.env, "Purchase", { value: 19.99, currency: "USD" });
    // Anything else is dropped, even if a caller tried.
    metaTrack(f.env, "Lead", { email: "a@example.com", search: "nurse", value: 5 } as never);
    expect(f.calls().slice(before)).toEqual([
      ["track", "Lead"],
      ["track", "Purchase", { value: 19.99, currency: "USD" }],
      ["track", "Lead"],
    ]);
    expect(cleanParams({ value: -1, currency: "USD" })).toBeUndefined();
    expect(cleanParams({ value: Number.NaN, currency: "USD" })).toBeUndefined();
    expect(cleanParams({ value: 9.99, currency: "usd" })).toBeUndefined();
  });

  it("is told when consent is withdrawn or given again", () => {
    const f = fakeEnv();
    loadMetaPixel(f.env, "678690642892717");
    metaConsent(f.env, false);
    metaConsent(f.env, true);
    expect(f.calls().slice(-2)).toEqual([["consent", "revoke"], ["consent", "grant"]]);
  });

  it("'No thanks' also deletes Meta's cookies", () => {
    expect(adCookieNames("_fbp=fb.1.1.1; theme=dark; _fbc=fb.1.1.x")).toEqual(["_fbp", "_fbc"]);
    expect(adStorageKeys(["_fbp", "_fbc", "gch_ads_consent", "saved_jobs"])).toEqual(["_fbp", "_fbc"]);
  });
});

describe("ad conversions without consent", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  it("sends nothing to Meta (or Microsoft) until advertising measurement is allowed", async () => {
    const f = fakeEnv();
    loadMetaPixel(f.env, "678690642892717"); // even a pixel already on the page
    const before = f.calls().length;
    g.window = Object.assign(f.win, { location: { pathname: "/alerts" } });
    g.document = f.env.doc;
    const { adConversion, adMeasurementAllowed, metaEvent } = await import("@/components/ads");
    expect(adMeasurementAllowed()).toBe(false);
    adConversion("subscribe", { event_category: "alerts" });
    adConversion("begin_trial", { event_category: "premium" });
    metaEvent("PageView");
    expect(f.calls().length).toBe(before);
  });
});
