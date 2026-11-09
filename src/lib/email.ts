/**
 * Email sending through Resend's HTTP API (no SDK needed).
 * Without RESEND_API_KEY nothing is sent (sign-ups still work while you set
 * up email). Only a one-line notice is logged: never the recipient or body,
 * which contain personal data and confirmation tokens.
 *
 * Double sends: a request can reach Resend and still fail on our side (a
 * timeout, a lost response). Every send can therefore carry an idempotency
 * key: Resend accepts a key once per 24 hours and answers a repeat of the same
 * request with the first result (2xx) instead of sending again. A failed
 * request with a key is retried once with the same key, so the retry can
 * never send twice. Only a 2xx answer counts as sent. Resend's 409 answers
 * mean nothing was sent by this request: concurrent_idempotent_requests (the
 * first request with this key is still being processed: retried once after a
 * short wait) and invalid_idempotent_request (the key was used with a
 * different message: a failure, logged).
 */
import { createHash } from "node:crypto";
import siteConfig from "@site-config";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /**
   * Stable key for this message, e.g. "welcome:123". A batch request takes one key for the
   * whole request (keyFor in sendBatch); a message's own key is used if the batch falls back
   * to sending its messages one by one.
   */
  idempotencyKey?: string;
};

export type SendResult = { ok: boolean; skipped?: boolean; id?: string; error?: string };

/** Each request to Resend gives up after this long. */
const TIMEOUT_MS = 10_000;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || siteConfig.emailFrom;
}

/** Replies go to the public contact address (the sending address is not read). */
function replyTo(): string | undefined {
  return siteConfig.contactEmail || undefined;
}

/** Resend's limit is 256 characters; longer keys are shortened to a hash. */
function cleanKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return key.length <= 256 ? key : `h:${createHash("sha256").update(key).digest("hex")}`;
}

/** Builds one batch key out of the per-message keys (Resend takes one key per batch request). */
export function batchKey(prefix: string, keys: string[]): string {
  return `${prefix}:${createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 40)}`;
}

function payload(m: OutgoingEmail) {
  return { from: fromAddress(), to: [m.to], reply_to: replyTo(), subject: m.subject, html: m.html, text: m.text, headers: m.headers };
}

type ResendReply = { status: number; data: { id?: string; message?: string; name?: string } };

const isOk = (r: ResendReply) => r.status >= 200 && r.status < 300;

/** Resend's 409 while the first request with the same idempotency key is still in progress. */
const isConcurrent = (r: ResendReply) => r.status === 409 && r.data.name === "concurrent_idempotent_requests";

/** Resend's reason for a failed request (its error name and message; never the recipient or body). */
function failure(r: ResendReply): string {
  if (r.status === 409 && r.data.name === "invalid_idempotent_request") {
    return `idempotency key already used for a different message (invalid_idempotent_request)${r.data.message ? `: ${r.data.message}` : ""}`;
  }
  if (isConcurrent(r)) return "a request with the same idempotency key is still in progress (concurrent_idempotent_requests)";
  return r.data.message || `Resend returned HTTP ${r.status}`;
}

/**
 * One POST to Resend. With an idempotency key, a network error, timeout,
 * 429, 5xx or concurrent_idempotent_requests is retried once with the same key.
 */
async function post(path: "/emails" | "/emails/batch", body: unknown, key: string | undefined): Promise<ResendReply> {
  const attempt = async (): Promise<ResendReply> => {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as ResendReply["data"];
    return { status: res.status, data };
  };
  try {
    const first = await attempt();
    if (!key || (first.status !== 429 && first.status < 500 && !isConcurrent(first))) return first;
  } catch (e) {
    if (!key) throw e;
  }
  await new Promise((r) => setTimeout(r, 1000));
  return attempt();
}

export async function sendEmail(msg: OutgoingEmail): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.info("email not sent: RESEND_API_KEY missing");
    return { ok: false, skipped: true, error: "Email sending is not configured" };
  }
  try {
    const res = await post("/emails", payload(msg), cleanKey(msg.idempotencyKey));
    if (!isOk(res)) {
      const error = failure(res);
      // Status and Resend's reason only: never the recipient or the body.
      console.warn(`email not sent: Resend ${res.status}: ${error}`);
      return { ok: false, error };
    }
    return { ok: true, id: res.data.id };
  } catch (e) {
    console.warn(`email not sent: ${(e as Error).message}`);
    return { ok: false, error: (e as Error).message };
  }
}

/** Spacing between single sends when a batch falls back to one request per message (Resend's default rate limit is a few requests per second). */
const FALLBACK_SPACING_MS = 500;

export type BatchResult = {
  sent: number;
  failed: number;
  errors: string[];
  /** One entry per message, in the order given: true when Resend accepted it. */
  delivered: boolean[];
};

/**
 * Send up to 100 emails per request (Resend batch API). keyFor(chunkIndex,
 * chunk) gives each request's idempotency key; it must give the same key for
 * the same messages.
 *
 * Resend validates a whole batch first and rejects all of it (422) when one
 * message is invalid, e.g. one malformed address. That chunk is then sent one
 * message per request, so one bad address doesn't stop everyone else's email.
 * Each of those requests carries the message's own idempotencyKey or, without
 * one, a key derived from the batch key and the recipient, so a retry of the
 * fallback can't send twice either. `delivered` says which messages went out,
 * so callers can mark exactly those as sent.
 */
export async function sendBatch(
  msgs: OutgoingEmail[],
  keyFor?: (chunkIndex: number, chunk: OutgoingEmail[]) => string,
): Promise<BatchResult> {
  const out: BatchResult = { sent: 0, failed: 0, errors: [], delivered: msgs.map(() => false) };
  if (!isEmailConfigured()) {
    if (msgs.length) console.info("email not sent: RESEND_API_KEY missing");
    out.failed = msgs.length;
    out.errors.push("Email sending is not configured (RESEND_API_KEY missing)");
    return out;
  }
  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100);
    const key = keyFor?.(i / 100, chunk);
    const mark = (j: number) => { out.delivered[i + j] = true; out.sent++; };
    try {
      const res = await post("/emails/batch", chunk.map(payload), cleanKey(key));
      // A repeat of a batch Resend already accepted is answered with its first result (2xx).
      if (isOk(res)) chunk.forEach((_, j) => mark(j));
      else if (res.status === 422) {
        console.warn(`email batch rejected: Resend 422: ${failure(res)}; sending its ${chunk.length} messages one by one`);
        for (const [j, m] of chunk.entries()) {
          if (j > 0) await new Promise((r) => setTimeout(r, FALLBACK_SPACING_MS));
          const one = await sendEmail({ ...m, idempotencyKey: m.idempotencyKey ?? (key ? `${key}:${m.to}` : undefined) });
          if (one.ok) mark(j);
          else {
            out.failed++;
            out.errors.push(one.error ?? "not sent");
          }
        }
      } else {
        const error = failure(res);
        console.warn(`email batch not sent: Resend ${res.status}: ${error}`);
        out.failed += chunk.length;
        out.errors.push(error);
      }
    } catch (e) {
      out.failed += chunk.length;
      out.errors.push((e as Error).message);
    }
  }
  return out;
}
