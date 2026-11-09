/**
 * Small Postgres-backed fixed-window rate limiter, plus the trusted client IP.
 *
 * Privacy: raw IP addresses are never written to the database. Keys are
 * stored as a salted one-way hash (SHA-256 of salt + key), and rows are
 * deleted once they are 24 hours old (cleanup runs on writes and in every
 * scheduled sync).
 */
import { createHash } from "node:crypto";
import { sql, transaction } from "@/lib/db";
import { sharedSecret } from "@/lib/server-secret";

/** Hash rows are kept at most this long (the privacy policy promises 24 hours). */
export const RATE_LIMIT_RETENTION_HOURS = 24;

/** The shared server secret (ANALYTICS_SALT, else CRON_SECRET); a constant only when neither is set (local development). */
function salt(): string {
  return sharedSecret() ?? "postbird-rate-limit";
}

/** Salted one-way hash used for every stored key (rate limits and failed admin sign-ins). */
export function hashKey(key: string): string {
  return createHash("sha256").update(`${salt()}|${key}`).digest("hex").slice(0, 40);
}

function isUndefinedTable(e: unknown): boolean {
  return (e as { code?: string })?.code === "42P01";
}

/**
 * The visitor's IP address as reported by the hosting platform. Never the
 * first X-Forwarded-For entry, which the client can set to anything.
 *  - Netlify: x-nf-client-connection-ip (set by Netlify's edge).
 *  - Vercel: x-real-ip / x-vercel-forwarded-for (Vercel overwrites these).
 *  - Otherwise: the LAST X-Forwarded-For hop, i.e. the one added by the proxy
 *    directly in front of the app.
 */
export function clientIp(headers: Headers): string {
  const nf = headers.get("x-nf-client-connection-ip")?.trim();
  if (nf) return nf;
  if (process.env.VERCEL) {
    const v = headers.get("x-real-ip")?.trim() || headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (v) return v;
  }
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return "unknown";
}

async function cleanup(): Promise<void> {
  await sql`delete from rate_limits where window_start < now() - make_interval(hours => ${RATE_LIMIT_RETENTION_HOURS})`;
  await sql`delete from admin_login_failures where at < now() - make_interval(hours => ${RATE_LIMIT_RETENTION_HOURS})`;
}

/** Deletes hashed abuse-protection rows older than 24 hours. Called by the scheduled sync. */
export async function cleanupRateLimits(): Promise<void> {
  try {
    await cleanup();
  } catch (e) {
    if (!isUndefinedTable(e)) throw e;
  }
}

/**
 * Counts one email of a kind to one address, unless `perDay` were already
 * counted for this key in the last 24 hours (then false: don't send). A
 * rolling 24 hours, unlike rateLimit's fixed windows. Stored in rate_limits as
 * a salted hash of the key, one row per email, and deleted after 24 hours
 * like every rate-limit row.
 *
 * Atomic: the count and the insert run in one transaction that first takes a
 * transaction-level advisory lock on the key, so calls for the same key at
 * the same moment run one after the other and can't both see room for one
 * more (the lock ends with the transaction, which also works through
 * Supabase's transaction pooler).
 */
export async function takeDailyQuota(key: string, perDay: number): Promise<boolean> {
  const hashed = hashKey(key);
  return transaction(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`daily-quota|${hashed}`}))`;
    const rows = await tx`
      insert into rate_limits (key, window_start, count)
      select ${hashed}, clock_timestamp(), 1
      where (select count(*) from rate_limits where key = ${hashed} and window_start > now() - interval '24 hours') < ${perDay}
      on conflict (key, window_start) do nothing
      returning 1`;
    return rows.length === 1;
  });
}

/**
 * Counts one hit for `key` in the current fixed window of `windowSeconds`.
 * Returns true when the request is allowed (at most `limit` hits per window).
 * Fails open (allows) only if the rate_limits table has not been created yet.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowSecs = Math.max(1, Math.floor(windowSeconds));
  try {
    const [row] = await sql<{ count: number }[]>`
      insert into rate_limits (key, window_start, count)
      values (${hashKey(key)}, to_timestamp(floor(extract(epoch from now()) / ${windowSecs}::int) * ${windowSecs}::int), 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count`;
    // Occasional cleanup keeps the table small and enforces the 24-hour retention.
    if (Math.random() < 0.05) await cleanup().catch(() => {});
    return Number(row.count) <= limit;
  } catch (e) {
    if (isUndefinedTable(e)) {
      console.warn("rate-limit: table rate_limits is missing; run db/migrations/003_security.sql");
      return true;
    }
    throw e;
  }
}
