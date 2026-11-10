"use client";

/**
 * Advertising measurement (Microsoft Advertising and Meta):
 *  - remembers which campaign a visitor came from (utm_* and msclkid), first touch, 90 days
 *  - loads the UET conversion tag when NEXT_PUBLIC_MS_UET_TAG_ID is set, and the Meta Pixel when
 *    NEXT_PUBLIC_META_PIXEL_ID is set (src/lib/meta-pixel.ts); both follow the same consent
 *  - where /api/geo says to ask first (everywhere except the United States,
 *    and when the place is unknown) nothing is stored on the device and
 *    neither Microsoft's nor Meta's script is loaded until the visitor clicks "Allow"; in the
 *    United States visitors can opt out any time, and Global Privacy Control
 *    counts as opting out. Opting out later stops the Meta Pixel ("revoke") and deletes both
 *    tags' cookies set on this site
 *  - never runs on /alerts/* (confirm/unsubscribe links carry personal tokens), /account (private link) or /admin
 *  - "Cookie settings" in the footer reopens the choice
 */
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ATTRIBUTION_KEY, clearAdStorage } from "@/lib/ad-storage";
import { loadMetaPixel, metaConsent, metaPixelLoaded, metaTrack, type MetaEvent, type MetaParams, type PixelEnv } from "@/lib/meta-pixel";

const ATTR_KEY = ATTRIBUTION_KEY;
const CONSENT_KEY = "gch_ads_consent";
const GEO_KEY = "gch_geo";
const OPEN_EVENT = "postbird:cookie-settings";
const ATTR_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "msclkid"] as const;

export type Attribution = Partial<Record<(typeof ATTR_FIELDS)[number], string>> & { landing?: string; at?: string };

declare global {
  interface Window {
    uetq?: unknown[] & { push: (...args: unknown[]) => number };
  }
}

/** Pages where no tracking of any kind runs. */
export function isPrivatePath(path: string) {
  return path.startsWith("/alerts/") || path === "/alerts/confirm" || path.startsWith("/admin") || path === "/account" || path.startsWith("/account/");
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// Attribution kept in memory too, so it survives in-site navigation even when
// nothing may be stored on the device (no consent yet).
let memoryAttribution: Attribution | null = null;
let storageAllowed = false;

/** Campaign parameters in the current URL, if any. */
export function attributionFromUrl(): Attribution | null {
  try {
    const p = new URLSearchParams(window.location.search);
    const a: Attribution = {};
    for (const f of ATTR_FIELDS) {
      const v = p.get(f);
      if (v) a[f] = v.slice(0, 120);
    }
    if (!Object.keys(a).length) return null;
    a.landing = window.location.pathname.slice(0, 200);
    a.at = new Date().toISOString();
    return a;
  } catch {
    return null;
  }
}

/** First-touch attribution (stored for 90 days only where allowed). */
export function getAttribution(): Attribution | null {
  if (memoryAttribution) return memoryAttribution;
  if (!storageAllowed) return null;
  try {
    const raw = local()?.getItem(ATTR_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Attribution;
    if (a.at && Date.now() - new Date(a.at).getTime() > 90 * 86_400_000) {
      local()?.removeItem(ATTR_KEY); // kept for 90 days only (see /privacy)
      return null;
    }
    return a;
  } catch {
    return null;
  }
}

function captureAttribution() {
  const fromUrl = attributionFromUrl();
  if (fromUrl && !memoryAttribution) memoryAttribution = fromUrl;
  persistAttribution();
}

function persistAttribution() {
  if (!storageAllowed || !memoryAttribution) return;
  try {
    const stored = local()?.getItem(ATTR_KEY);
    const at = stored ? (JSON.parse(stored) as Attribution).at : undefined;
    // First touch wins, for 90 days; an older one is replaced.
    if (!stored || (at && Date.now() - new Date(at).getTime() > 90 * 86_400_000)) local()?.setItem(ATTR_KEY, JSON.stringify(memoryAttribution));
  } catch {
    /* storage blocked: attribution simply isn't kept */
  }
}

const CONSENT_EVENT = "postbird:consent-changed";

/**
 * Microsoft's click id (msclkid) is unique to one ad click, so it is only kept
 * when advertising cookies are allowed. Otherwise it is replaced by "present":
 * enough to count a visit as coming from an ad, without an identifier.
 */
export function withoutClickId(a: Attribution | null): Attribution | null {
  if (!a || storageAllowed || !a.msclkid) return a;
  return { ...a, msclkid: "present" };
}

/** True when advertising measurement is allowed for this visitor (consent given, or not required and not refused). */
export function adMeasurementAllowed(): boolean {
  return storageAllowed;
}

/** Report a conversion to Microsoft Ads (no-op when UET isn't loaded, or advertising measurement isn't allowed). */
export function uetEvent(action: string, params: Record<string, string | number> = {}) {
  try {
    if (!storageAllowed || !document.getElementById("uet-tag")) return;
    window.uetq = window.uetq || ([] as unknown as NonNullable<Window["uetq"]>);
    window.uetq.push("event", action, params);
  } catch {
    /* never break the page */
  }
}

const pixelEnv = (): PixelEnv => ({ win: window as unknown as PixelEnv["win"], doc: document });

/** Report an event to Meta (no-op without the pixel, without advertising consent, or on private pages). */
export function metaEvent(event: MetaEvent, params?: MetaParams) {
  try {
    if (!storageAllowed || isPrivatePath(window.location.pathname)) return;
    metaTrack(pixelEnv(), event, params);
  } catch {
    /* never break the page */
  }
}

/**
 * Conversions, by their UET action name, that also go to Meta as a standard event. The free
 * weekly email sign-up is Meta's "Lead"; a completed Paddle checkout is "StartTrial" or "Purchase".
 * (Early access, "trial_signup", isn't sent to Meta.)
 */
const META_CONVERSIONS: Record<string, MetaEvent> = { subscribe: "Lead", begin_trial: "StartTrial", purchase: "Purchase" };

/**
 * Report a conversion to every ad platform that is loaded and allowed: Microsoft Ads (action and
 * params as for uetEvent) and, for the actions in META_CONVERSIONS, Meta (only `meta`: value and
 * currency, never personal data).
 */
export function adConversion(action: string, params: Record<string, string | number> = {}, meta?: MetaParams) {
  uetEvent(action, params);
  const m = META_CONVERSIONS[action];
  if (m) metaEvent(m, meta);
}

function loadUet(tagId: string, granted: boolean) {
  if (document.getElementById("uet-tag")) return;
  window.uetq = window.uetq || ([] as unknown as NonNullable<Window["uetq"]>);
  window.uetq.push("consent", "default", { ad_storage: granted ? "granted" : "denied" });
  const s = document.createElement("script");
  s.id = "uet-tag";
  s.async = true;
  s.src = "https://bat.bing.com/bat.js";
  s.onload = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const UET = (window as any).UET;
      const queue = window.uetq;
      // Page views are reported manually (see AdsManager) so private pages are never sent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o: any = { ti: tagId, enableAutoSpaTracking: false, q: queue };
      window.uetq = new UET(o);
      window.uetq!.push("pageLoad");
    } catch {
      /* ignore */
    }
  };
  document.head.appendChild(s);
}

type Geo = { consentRequired: boolean };

async function fetchGeo(): Promise<Geo> {
  try {
    const cached = window.sessionStorage.getItem(GEO_KEY);
    if (cached) return JSON.parse(cached) as Geo;
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch("/api/geo", { cache: "no-store" });
    const geo = (await res.json()) as Geo;
    const value = { consentRequired: geo.consentRequired !== false };
    try {
      window.sessionStorage.setItem(GEO_KEY, JSON.stringify(value));
    } catch {
      /* ignore */
    }
    return value;
  } catch {
    return { consentRequired: true };
  }
}

/**
 * Whether this visitor is where consent is asked before anything optional loads (see
 * src/app/api/geo/route.ts), or unknown (the same /api/geo answer, cached for the tab, as the cookie choice).
 * Never rejects; true until known or when the check fails.
 */
export function consentRegion(): Promise<boolean> {
  return fetchGeo().then((g) => g.consentRequired).catch(() => true);
}

/** Footer link that reopens the cookie choice. */
export function CookieSettingsLink({ className = "" }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      Cookie settings / Your privacy choices
    </button>
  );
}

/** The cookie-choice question, naming the ad platforms that are switched on. */
export function consentQuestion(uet: boolean, meta: boolean): string {
  const vendors = [uet ? "Microsoft Advertising (_uetsid, _uetvid, MUID)" : null, meta ? "Meta (_fbp, _fbc)" : null].filter(Boolean);
  if (!vendors.length) {
    return "May we remember which ad or link brought you here (stored on your device for up to 90 days)? It only tells us whether our ads lead to sign-ups.";
  }
  const who = uet && meta ? "Microsoft and Meta also process this data under their own privacy policies" : uet ? "Microsoft also processes this data under its own privacy statement" : "Meta also processes this data under its own privacy policy";
  return `May we use advertising cookies from ${vendors.join(" and ")} and remember which ad brought you here? This tells us whether our ads lead to sign-ups; ${who}. We never send them your email address.`;
}

/** Mount once in the root layout. */
export function AdsManager({ tagId, metaPixelId = null }: { tagId: string | null; metaPixelId?: string | null }) {
  const pathname = usePathname();
  const [panel, setPanel] = useState<null | { consentRequired: boolean }>(null);
  const geoRef = useRef<Geo | null>(null);
  const firstPath = useRef<string | null>(null);

  const apply = useCallback(
    (geo: Geo) => {
      const saved = local()?.getItem(CONSENT_KEY) ?? null;
      // Global Privacy Control counts as an opt-out where consent isn't required up front.
      const gpc = typeof navigator !== "undefined" && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
      const granted = geo.consentRequired || gpc ? saved === "granted" : saved !== "denied";
      storageAllowed = granted;
      window.dispatchEvent(new Event(CONSENT_EVENT));
      captureAttribution();
      if (granted && !isPrivatePath(window.location.pathname)) {
        if (tagId) loadUet(tagId, true);
        if (metaPixelId) loadMetaPixel(pixelEnv(), metaPixelId);
      }
      return { saved, granted };
    },
    [tagId, metaPixelId],
  );

  // First visit: find out whether consent is needed, then act on it.
  useEffect(() => {
    let cancelled = false;
    if (attributionFromUrl() && !memoryAttribution) memoryAttribution = attributionFromUrl();
    fetchGeo().then((geo) => {
      if (cancelled) return;
      geoRef.current = geo;
      const { saved } = apply(geo);
      if ((tagId || metaPixelId) && geo.consentRequired && !saved && !isPrivatePath(window.location.pathname)) setPanel({ consentRequired: true });
    });
    const open = () => setPanel({ consentRequired: geoRef.current?.consentRequired ?? true });
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      cancelled = true;
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, [apply, tagId, metaPixelId]);

  // In-site navigation: report page views manually, never for private pages.
  useEffect(() => {
    if (firstPath.current === null) {
      firstPath.current = pathname;
      return;
    }
    if (!storageAllowed || isPrivatePath(pathname)) return;
    try {
      if (document.getElementById("uet-tag")) window.uetq?.push("event", "page_view", { page_path: pathname });
    } catch {
      /* ignore */
    }
    // The pixel reported the page it loaded on itself; this is each later in-site page.
    if (metaPixelLoaded(pixelEnv())) metaEvent("PageView");
  }, [pathname]);

  if (!panel) return null;
  const choose = (value: "granted" | "denied") => {
    try {
      local()?.setItem(CONSENT_KEY, value);
    } catch {
      /* ignore */
    }
    if (value === "denied") {
      storageAllowed = false;
      window.uetq?.push("consent", "update", { ad_storage: "denied" });
      // A Meta Pixel already loaded on this page sends nothing more.
      metaConsent(pixelEnv(), false);
      // Whatever the tags (or we) already stored during this visit goes too: UET's and Meta's
      // cookies and storage entries, and the remembered campaign (gch_attr).
      clearAdStorage({ doc: document, hostname: window.location.hostname, stores: [local(), session()] });
      window.dispatchEvent(new Event(CONSENT_EVENT));
    } else {
      storageAllowed = true;
      persistAttribution();
      window.dispatchEvent(new Event(CONSENT_EVENT));
      if (tagId && !isPrivatePath(window.location.pathname)) {
        if (document.getElementById("uet-tag")) window.uetq?.push("consent", "update", { ad_storage: "granted" });
        else loadUet(tagId, true);
      }
      if (metaPixelId && !isPrivatePath(window.location.pathname)) {
        if (metaPixelLoaded(pixelEnv())) metaConsent(pixelEnv(), true);
        else loadMetaPixel(pixelEnv(), metaPixelId);
      }
    }
    setPanel(null);
  };
  return (
    <div role="dialog" aria-label="Cookie settings" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-rule bg-paper p-4 shadow-lg sm:inset-x-auto sm:right-4">
      <p className="text-sm leading-relaxed text-ink">
        {consentQuestion(Boolean(tagId), Boolean(metaPixelId))}{" "}
        <Link href="/privacy#cookies" className="text-accent underline">Details</Link>
      </p>
      {/* Both choices look the same, so neither is pushed. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => choose("granted")} className="rounded-md border border-ink/70 bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-mist">Allow</button>
        <button onClick={() => choose("denied")} className="rounded-md border border-ink/70 bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-mist">No thanks</button>
      </div>
    </div>
  );
}

/** Hidden form field carrying the visitor's campaign attribution to the server. */
export function AttributionField() {
  const [value, setValue] = useState("");
  useEffect(() => {
    // Recomputed when the consent choice becomes known or changes, so a click id is only sent when allowed.
    const update = () => {
      const a = withoutClickId(getAttribution() ?? attributionFromUrl());
      setValue(a ? JSON.stringify(a) : "");
    };
    const t = setTimeout(update, 0);
    window.addEventListener(CONSENT_EVENT, update);
    return () => {
      clearTimeout(t);
      window.removeEventListener(CONSENT_EVENT, update);
    };
  }, []);
  return <input type="hidden" name="attribution" value={value} />;
}
