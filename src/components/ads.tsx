"use client";

/**
 * Microsoft Advertising (Bing Ads) support:
 *  - stores which campaign a visitor came from (utm_* and msclkid), first touch, 90 days
 *  - loads the UET conversion tag when NEXT_PUBLIC_MS_UET_TAG_ID is set
 *  - asks for ad-measurement consent only where Microsoft requires it (EEA, UK, Switzerland)
 */
import { useEffect, useState } from "react";

const ATTR_KEY = "gch_attr";
const CONSENT_KEY = "gch_ads_consent";
const ATTR_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "msclkid"] as const;

export type Attribution = Partial<Record<(typeof ATTR_FIELDS)[number], string>> & { landing?: string; at?: string };

declare global {
  interface Window {
    uetq?: unknown[] & { push: (...args: unknown[]) => number };
  }
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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

/** First-touch attribution, kept for 90 days. */
export function getAttribution(): Attribution | null {
  try {
    const raw = store()?.getItem(ATTR_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Attribution;
    if (a.at && Date.now() - new Date(a.at).getTime() > 90 * 86_400_000) return null;
    return a;
  } catch {
    return null;
  }
}

function captureAttribution() {
  const fromUrl = attributionFromUrl();
  if (fromUrl && !getAttribution()) {
    try {
      store()?.setItem(ATTR_KEY, JSON.stringify(fromUrl));
    } catch {
      /* storage blocked: attribution simply isn't kept */
    }
  }
}

/** Report a conversion to Microsoft Ads (no-op when UET isn't installed). */
export function uetEvent(action: string, params: Record<string, string | number> = {}) {
  try {
    window.uetq = window.uetq || ([] as unknown as NonNullable<Window["uetq"]>);
    window.uetq.push("event", action, params);
  } catch {
    /* never break the page */
  }
}

function loadUet(tagId: string) {
  if (document.getElementById("uet-tag")) return;
  const s = document.createElement("script");
  s.id = "uet-tag";
  s.async = true;
  s.src = "https://bat.bing.com/bat.js";
  s.onload = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const UET = (window as any).UET;
      const queue = window.uetq;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o: any = { ti: tagId, enableAutoSpaTracking: true, q: queue };
      window.uetq = new UET(o);
      window.uetq!.push("pageLoad");
    } catch {
      /* ignore */
    }
  };
  document.head.appendChild(s);
}

/** Mount once in the root layout. */
export function AdsManager({ tagId, consentRequired }: { tagId: string | null; consentRequired: boolean }) {
  const [askConsent, setAskConsent] = useState(false);

  useEffect(() => {
    captureAttribution();
    if (!tagId) return;
    const saved = store()?.getItem(CONSENT_KEY);
    const granted = consentRequired ? saved === "granted" : saved !== "denied";
    window.uetq = window.uetq || ([] as unknown as NonNullable<Window["uetq"]>);
    window.uetq.push("consent", "default", { ad_storage: granted ? "granted" : "denied" });
    loadUet(tagId);
    // Show the notice only where consent is required and the visitor hasn't chosen yet.
    if (consentRequired && !saved) {
      const t = setTimeout(() => setAskConsent(true), 0);
      return () => clearTimeout(t);
    }
  }, [tagId, consentRequired]);

  if (!askConsent) return null;
  const choose = (value: "granted" | "denied") => {
    try {
      store()?.setItem(CONSENT_KEY, value);
    } catch {
      /* ignore */
    }
    window.uetq?.push("consent", "update", { ad_storage: value });
    setAskConsent(false);
  };
  return (
    <div role="region" aria-label="Cookie choice" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-rule bg-paper p-4 shadow-lg sm:inset-x-auto sm:right-4">
      <p className="text-sm text-ink">
        We use one advertising cookie to measure whether our ads lead to sign-ups. Allow it?
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => choose("granted")} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent">Allow</button>
        <button onClick={() => choose("denied")} className="rounded-md border border-rule px-4 py-2 text-sm font-medium text-ink hover:bg-mist">No thanks</button>
      </div>
    </div>
  );
}

/** Hidden form field carrying the visitor's campaign attribution to the server. */
export function AttributionField() {
  const [value, setValue] = useState("");
  useEffect(() => {
    const a = getAttribution() ?? attributionFromUrl();
    if (a) {
      const t = setTimeout(() => setValue(JSON.stringify(a)), 0);
      return () => clearTimeout(t);
    }
  }, []);
  return <input type="hidden" name="attribution" value={value} />;
}
