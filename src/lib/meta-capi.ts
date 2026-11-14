/**
 * Meta Conversions API: the same conversions the browser pixel reports (Lead, StartTrial,
 * Purchase), sent from the server, so a visitor whose browser blocks Meta's script is still
 * counted. Meta removes the duplicate when both arrive (same event name and event_id).
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

export type MetaMatch = { eventId: string; fbc?: string; fbp?: string; url?: string };
export type CapiEvent = "Lead" | "StartTrial" | "Purchase";

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
  if (o.ip) user_data.client_ip_address = o.ip;
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
