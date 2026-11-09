/**
 * First-party, cookieless analytics stored in the `events` table.
 * Visitors are counted with a hash of (IP + browser + date + secret) that
 * changes every day, so no IP address or long-term identifier is stored.
 */
import { createHash } from "node:crypto";
import { sharedSecret } from "@/lib/server-secret";
import { sql } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

export const EVENT_TYPES = [
  "pageview", "job_view", "search", "apply_click", "alert_signup", "waitlist_signup",
  "alert_confirmed", "premium_cta_click", "plan_choice", "book_click",
  // Paid alerts (recorded by the Paddle webhook, with the subscriber's first-touch campaign in props.campaign).
  "trial_started", "subscription_canceled",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http-client/i;

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

export function visitorHash(ip: string, userAgent: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const secret = sharedSecret() ?? "gch";
  return createHash("sha256").update(`${day}|${ip}|${userAgent}|${secret}`).digest("hex").slice(0, 20);
}

export async function recordEvent(e: { type: EventType; path?: string | null; jobId?: number | null; visitor?: string | null; referrer?: string | null; props?: Record<string, unknown> | null }) {
  try {
    await sql`
      insert into events (type, path, job_id, visitor, referrer, props)
      values (${e.type}, ${e.path?.slice(0, 500) ?? null}, ${e.jobId ?? null}, ${e.visitor ?? null}, ${e.referrer?.slice(0, 200) ?? null},
              ${e.props ? sql.json(e.props as never) : null})`;
  } catch (err) {
    console.warn("analytics: could not record event", (err as Error).message);
  }
}

const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "msclkid", "landing"];

/** Keep only known campaign fields, trimmed. */
export function cleanCampaign(c: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!c || typeof c !== "object") return null;
  const out: Record<string, string> = {};
  for (const k of CAMPAIGN_KEYS) if (typeof c[k] === "string" && c[k]) out[k] = (c[k] as string).slice(0, 120);
  return Object.keys(out).length ? out : null;
}

/** Visitor hash for server actions (same daily hash as the tracking endpoint). */
export function visitorFromHeaders(h: Headers): string | null {
  const ua = h.get("user-agent");
  if (isBot(ua)) return null;
  return visitorHash(clientIp(h), ua ?? "");
}

/** How long a Microsoft click id (msclkid) value is kept with the visit counts before it is reduced to "present". */
export const CLICK_ID_DAYS = 90;

/**
 * Privacy-policy retention, run by the scheduled clean-up: in events older than CLICK_ID_DAYS,
 * the Microsoft click id stored with consent (in the page address, msclkid=…, and in the
 * campaign tags, props.campaign.msclkid) becomes "present", so the visit still counts as an ad
 * visit but the click can no longer be identified. Returns how many events were changed.
 */
export async function reduceOldClickIds(days = CLICK_ID_DAYS): Promise<number> {
  const rows = await sql`
    update events set
      path = case when path ~* '[?&]msclkid=' then regexp_replace(path, '([?&]msclkid=)[^&]*', '\\1present', 'gi') else path end,
      props = case when props->'campaign'->>'msclkid' is not null and props->'campaign'->>'msclkid' <> 'present'
                   then jsonb_set(props, '{campaign,msclkid}', '"present"') else props end
    where created_at < now() - make_interval(days => ${days})
      and ((path ~* '[?&]msclkid=' and regexp_replace(path, '([?&]msclkid=)[^&]*', '\\1present', 'gi') <> path)
           or (props->'campaign'->>'msclkid' is not null and props->'campaign'->>'msclkid' <> 'present'))
    returning 1`;
  return rows.length;
}
