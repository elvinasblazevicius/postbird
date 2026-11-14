/**
 * Meta Conversions API: the same page views and conversions the browser pixel reports (PageView,
 * Lead, StartTrial, Purchase), sent from the server, so a visitor whose browser blocks Meta's script
 * is still counted. Meta removes the duplicate when both arrive (same event name and event_id).
 *
 * Only for visitors who allowed advertising measurement: the browser sends the `meta` field
 * (MetaMatchField in src/components/ads.tsx) only then, and without it nothing is sent.
 * What goes to Meta: the event, the page address, the visitor's IP address and browser
 * (as Meta asks, to match the visit), the email address as a one-way SHA-256 hash, Meta's own
 * click and browser ids (_fbc, _fbp) when present, and the plan's price for a purchase.
 * Nothing is stored here. Off unless META_CAPI_TOKEN is set (server only, never in the browser).
 */
import { createHash } from "node:crypto";
import { META_PIXEL_ID } from "@/lib/meta-pixel";
import { absoluteUrl } from "@/lib/site";

export type MetaMatch = { eventId: string; fbc?: string; fbp?: string; url?: string };
export type CapiEvent = "PageView" | "Lead" | "StartTrial" | "Purchase";

const API_VERSION = "v21.0";

/** The `meta` form field, or null when absent or malformed (no consent: nothing is sent). */
export function parseMetaMatch(raw: unknown): MetaMatch | null {
  if (typeof raw !== "string" || !raw || raw.length > 1200) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const eventId = typeof v.eventId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v.eventId) ? v.eventId : null;
    if (!eventId) return null;
    const ok = (s: unknown, re: RegExp) => (typeof s === "string" && re.test(s) ? s : undefined);
    return {
      eventId,
      fbc: ok(v.fbc, /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{10,500}$/),
      fbp: ok(v.fbp, /^fb\.\d\.\d{10,13}\.\d{5,25}$/),
      url: ok(v.url, /^https:\/\/[^\s]{1,500}$/),
    };
  } catch {
    return null;
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

/** The request body Meta expects for one event (exported for the tests). */
export function capiBody(o: { event: CapiEvent; match: MetaMatch; email?: string | null; ip?: string | null; ua?: string | null; value?: number; currency?: string; now?: number }) {
  const user_data: Record<string, unknown> = {};
  if (o.email) user_data.em = [sha256(o.email)];
  if (o.ip && o.ip !== "unknown") user_data.client_ip_address = o.ip;
  if (o.ua) user_data.client_user_agent = o.ua.slice(0, 500);
  if (o.match.fbc) user_data.fbc = o.match.fbc;
  if (o.match.fbp) user_data.fbp = o.match.fbp;
  const custom_data = typeof o.value === "number" && o.currency ? { value: o.value, currency: o.currency } : undefined;
  return {
    data: [{
      event_name: o.event,
      event_time: Math.floor((o.now ?? Date.now()) / 1000),
      event_id: o.match.eventId,
      action_source: "website",
      ...(o.match.url ? { event_source_url: o.match.url } : {}),
      user_data,
      ...(custom_data ? { custom_data } : {}),
    }],
  };
}

/** Sends one event; never throws and never delays the visitor for long (4 s timeout). */
export async function sendCapiEvent(o: Parameters<typeof capiBody>[0]): Promise<boolean> {
  const token = process.env.META_CAPI_TOKEN?.trim();
  if (!token || !META_PIXEL_ID || process.env.VITEST) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // META_CAPI_TEST_CODE (optional, from Events Manager → Test events): the events show there instead of counting. Remove after testing.
      body: JSON.stringify({ ...capiBody(o), ...(process.env.META_CAPI_TEST_CODE?.trim() ? { test_event_code: process.env.META_CAPI_TEST_CODE.trim() } : {}) }),
      signal: ctrl.signal,
    });
    if (!res.ok) console.error("meta capi: event not accepted", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error("meta capi: send failed", (e as Error).message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Admin → Overview "Meta check": one PageView sent with Meta's test code (Events Manager → Test
 * events), so it shows there at once and never counts toward ads. Says whether the token is set and
 * what Meta answered (never the token itself).
 */
/** `ip` and `ua`: the admin's own, as a real page view carries the visitor's (Meta refuses an event without them). */
export async function metaCapiCheck(testCode: string, visitor: { ip?: string | null; ua?: string | null } = {}): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.META_CAPI_TOKEN?.trim();
  if (!META_PIXEL_ID) return { ok: false, detail: "No Pixel ID in this build (NEXT_PUBLIC_META_PIXEL_ID)." };
  if (!token) return { ok: false, detail: "META_CAPI_TOKEN is not set in Netlify, so the server sends nothing to Meta." };
  const code = testCode.trim();
  if (!/^TEST[A-Z0-9]{3,20}$/i.test(code)) return { ok: false, detail: "Paste the test code from Events Manager → your pixel → Test events (it starts with TEST)." };
  const body = capiBody({ event: "PageView", match: { eventId: `check-${Date.now()}`, url: absoluteUrl("/") }, ip: visitor.ip, ua: visitor.ua ?? "Postbird Meta check" });
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, test_event_code: code }),
      signal: AbortSignal.timeout(8000),
    });
    const text = (await res.text().catch(() => "")).slice(0, 400);
    if (res.ok) return { ok: true, detail: `Meta accepted the test page view sent with test code ${code} (${text}). With that code's Test events tab open in Events Manager, it shows there within a minute.` };
    const msg = (() => { try { return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text; } catch { return text; } })();
    return { ok: false, detail: `Meta refused it (${res.status}): ${msg}` };
  } catch (e) {
    return { ok: false, detail: `Couldn't reach Meta: ${(e as Error).message}` };
  }
}
