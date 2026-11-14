/**
 * Meta Pixel (Facebook and Instagram ads), loaded by src/components/ads.tsx only when advertising
 * measurement is allowed for the visitor (the same consent as Microsoft's UET tag) and
 * NEXT_PUBLIC_META_PIXEL_ID is set. Without the ID nothing here does anything.
 *
 * Data minimisation (Employment ads, a scam-sensitive audience):
 *  - autoConfig is off, so the pixel doesn't read buttons, forms or page metadata;
 *  - init is called without customer data (no advanced matching from this code; switch off
 *    "Automatic advanced matching" in Events Manager too); the server's Conversions API copy of
 *    each event (src/lib/meta-capi.ts) carries the same event id, so Meta counts it once;
 *  - events take only a numeric value and a currency code (MetaParams), never an email address,
 *    a name, search terms or anything typed into a form;
 *  - page views are reported by AdsManager, never by the pixel's own History API listener
 *    (disablePushState), so private pages are never sent and the first page isn't counted twice.
 *
 * Pure helpers with the window and document passed in, so they are unit-tested without a browser.
 */

export const META_PIXEL_SRC = "https://connect.facebook.net/en_US/fbevents.js";
export const META_PIXEL_SCRIPT_ID = "meta-pixel";

/** The standard events the site sends. */
export type MetaEvent = "PageView" | "Lead" | "StartTrial" | "Purchase";
/** The only parameters ever sent with an event. */
export type MetaParams = { value?: number; currency?: string };

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};

export type PixelWindow = { fbq?: Fbq; _fbq?: Fbq };
type PixelDocument = {
  getElementById: (id: string) => unknown;
  createElement: (tag: "script") => { id: string; async: boolean; src: string };
  head: { appendChild: (el: never) => unknown };
};
export type PixelEnv = { win: PixelWindow; doc: PixelDocument };

/** A Pixel ID is a string of digits; anything else (empty, placeholder text) means "no pixel". */
export function parsePixelId(raw: string | null | undefined): string | null {
  const id = (raw ?? "").trim();
  return /^\d{6,20}$/.test(id) ? id : null;
}

/** The Pixel ID this build was made with, or null (then the pixel is off). */
export const META_PIXEL_ID = parsePixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID);

export function metaPixelLoaded(env: PixelEnv): boolean {
  return Boolean(env.doc.getElementById(META_PIXEL_SCRIPT_ID));
}

/** Meta's base-code queue (what the standard inline snippet sets up), without an inline script. */
function fbqStub(win: PixelWindow): Fbq {
  if (win.fbq) return win.fbq;
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue.push(args);
  } as Fbq;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  win.fbq = n;
  if (!win._fbq) win._fbq = n;
  return n;
}

/**
 * Loads the pixel and reports the current page view. Call only once advertising measurement is
 * allowed. Returns false (and does nothing) when the ID is invalid or the pixel is already there.
 */
export function loadMetaPixel(env: PixelEnv, pixelId: string | null, pageViewId?: string): boolean {
  const id = parsePixelId(pixelId);
  if (!id || metaPixelLoaded(env)) return false;
  const fbq = fbqStub(env.win);
  // Page views come from AdsManager only (private pages skipped, no double count on the first page).
  fbq.disablePushState = true;
  fbq("consent", "grant");
  // Before init: no automatic events from buttons, forms or page metadata.
  fbq("set", "autoConfig", false, id);
  fbq("init", id);
  // With the id the server also sends to the Conversions API for this page view (Meta counts it once).
  if (pageViewId) fbq("track", "PageView", {}, { eventID: pageViewId });
  else fbq("track", "PageView");
  const s = env.doc.createElement("script");
  s.id = META_PIXEL_SCRIPT_ID;
  s.async = true;
  s.src = META_PIXEL_SRC;
  env.doc.head.appendChild(s as never);
  return true;
}

/** Keeps only a non-negative number value and a three-letter currency code. */
export function cleanParams(p?: MetaParams): MetaParams | undefined {
  if (!p) return undefined;
  const out: MetaParams = {};
  if (typeof p.value === "number" && Number.isFinite(p.value) && p.value >= 0) out.value = Math.round(p.value * 100) / 100;
  if (typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency)) out.currency = p.currency;
  // Meta wants value and currency together.
  if (out.value === undefined || out.currency === undefined) return undefined;
  return out;
}

/**
 * Sends one event. No-op unless the pixel was loaded (consent given and ID set). `eventId` is the
 * id the server also sends to the Conversions API for the same conversion, so Meta counts it once.
 */
export function metaTrack(env: PixelEnv, event: MetaEvent, params?: MetaParams, eventId?: string): boolean {
  if (!metaPixelLoaded(env) || !env.win.fbq) return false;
  const p = cleanParams(params);
  if (eventId) env.win.fbq("track", event, p ?? {}, { eventID: eventId });
  else if (p) env.win.fbq("track", event, p);
  else env.win.fbq("track", event);
  return true;
}

/** Tells a loaded pixel that consent was withdrawn ("revoke": it sends nothing more) or given again. */
export function metaConsent(env: PixelEnv, granted: boolean): void {
  if (!metaPixelLoaded(env) || !env.win.fbq) return;
  env.win.fbq("consent", granted ? "grant" : "revoke");
}
