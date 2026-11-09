/**
 * Paddle Billing, server side only (it reads PADDLE_API_KEY and
 * PADDLE_WEBHOOK_SECRET; never import it from a client component).
 *
 * Written against Paddle's docs (developer.paddle.com, November 2026):
 *  - API: https://api.paddle.com (live) or https://sandbox-api.paddle.com,
 *    authenticated with "Authorization: Bearer <API key>".
 *  - Webhooks: the Paddle-Signature header is "ts=<unix seconds>;h1=<hex>",
 *    where h1 = HMAC-SHA256(endpoint secret, "<ts>:<raw body>").
 * No Paddle SDK is needed for the few calls made here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PADDLE_ENV } from "@/lib/billing/live";

export function paddleApiBase(env: "sandbox" | "production" = PADDLE_ENV): string {
  return env === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

export function isPaddleApiConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY);
}

// ── Webhook signatures ───────────────────────────────────────

/**
 * How old a webhook's timestamp may be. Paddle's SDKs use 5 seconds; a
 * little more allows for clock drift and serverless cold starts. Replays
 * inside the window are harmless anyway: every event_id is processed once.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 60;

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

/** Parses "ts=...;h1=...;h1=..." (more than one h1 may appear while Paddle rotates secrets). */
export function parseSignatureHeader(header: string | null): { ts: number; h1: string[] } | null {
  if (!header) return null;
  let ts = NaN;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "ts" && /^\d{1,12}$/.test(v)) ts = Number(v);
    if (k === "h1" && /^[0-9a-f]{64}$/i.test(v)) h1.push(v.toLowerCase());
  }
  return Number.isFinite(ts) && h1.length ? { ts, h1 } : null;
}

/** The h1 value Paddle would send for this body and timestamp (also used by tests). */
export function signPayload(rawBody: string, ts: number, secret: string): string {
  return createHmac("sha256", secret).update(`${ts}:${rawBody}`, "utf8").digest("hex");
}

/**
 * Verifies the Paddle-Signature header against the raw request body, exactly
 * as received (re-serialized JSON would not match). Constant-time compare.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined = process.env.PADDLE_WEBHOOK_SECRET,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!secret || !header) return { ok: false, reason: "missing" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };
  // Too old (possible replay) or too far in the future (clock trouble).
  if (Math.abs(nowSeconds - parsed.ts) > toleranceSeconds) return { ok: false, reason: "expired" };
  const expected = Buffer.from(signPayload(rawBody, parsed.ts, secret), "hex");
  for (const h of parsed.h1) {
    const got = Buffer.from(h, "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}

// ── API calls ────────────────────────────────────────────────

class PaddleApiError extends Error {
  constructor(public status: number, public code: string | null) {
    super(`Paddle API returned HTTP ${status}${code ? ` (${code})` : ""}`);
  }
}

/** Calls the Paddle API. Errors carry only the status and Paddle's error code, never the key. */
async function paddleFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error("PADDLE_API_KEY is not set");
  const res = await fetch(`${paddleApiBase()}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string } } | null;
  if (!res.ok || !data?.data) throw new PaddleApiError(res.status, data?.error?.code ?? null);
  return data.data;
}

const PADDLE_ID = (prefix: string) => new RegExp(`^${prefix}_[a-z\\d]{26}$`);

/**
 * A customer portal session: one-time links where the customer can update
 * their card, see invoices and cancel. Links are temporary; don't store them.
 * Returns the cancel/manage link for the subscription when there is one,
 * otherwise the portal overview. Needs the customer_portal_session.write permission.
 */
export async function createPortalSession(customerId: string, subscriptionId?: string | null): Promise<string> {
  if (!PADDLE_ID("ctm").test(customerId)) throw new Error("Invalid Paddle customer id");
  const subs = subscriptionId && PADDLE_ID("sub").test(subscriptionId) ? [subscriptionId] : [];
  const session = await paddleFetch<{
    urls: { general: { overview: string }; subscriptions: { id: string; view_subscription?: string; cancel_subscription?: string }[] };
  }>(`/customers/${customerId}/portal-sessions`, { method: "POST", body: { subscription_ids: subs } });
  // The overview lists the subscription with "cancel" and "update payment method"
  // buttons, so it serves both "manage billing" and "cancel".
  return session.urls.general.overview;
}

/** Subscription fields this site reads (a subset of Paddle's subscription entity). */
export type PaddleSubscription = {
  id: string;
  status: "active" | "canceled" | "past_due" | "paused" | "trialing" | string;
  customer_id: string;
  custom_data: Record<string, unknown> | null;
  billing_cycle?: { interval: string; frequency: number } | null;
  current_billing_period?: { starts_at: string; ends_at: string } | null;
  next_billed_at?: string | null;
  canceled_at?: string | null;
  paused_at?: string | null;
  scheduled_change?: { action: "cancel" | "pause" | "resume" | string; effective_at: string } | null;
  items?: { price?: { id?: string } | null; trial_dates?: { starts_at: string; ends_at: string } | null }[];
};

/** Fetches a subscription (needs the subscription.read permission). */
export async function getSubscription(subscriptionId: string): Promise<PaddleSubscription> {
  if (!PADDLE_ID("sub").test(subscriptionId)) throw new Error("Invalid Paddle subscription id");
  return paddleFetch<PaddleSubscription>(`/subscriptions/${subscriptionId}`);
}
