/**
 * The server secret that keys one-way codes which the website and the
 * scheduled jobs (GitHub Actions) must compute the same way: ANALYTICS_SALT
 * when it is set, otherwise CRON_SECRET. Both places must have exactly the
 * same values (README → Step 4). Server only.
 *
 * null when neither is set: callers that store or compare codes across the
 * two places (trial markers) then do nothing rather than fall back to a
 * constant that the other place wouldn't use.
 */
import { createHmac } from "node:crypto";

export function sharedSecret(): string | null {
  return process.env.ANALYTICS_SALT || process.env.CRON_SECRET || null;
}

/**
 * A short code that tells whether two places use the same secret without
 * revealing it: the first 12 hex characters of HMAC-SHA256(secret,
 * "postbird-fingerprint"). null when no secret is set.
 */
export function secretFingerprint(secret: string | null = sharedSecret()): string | null {
  return secret ? createHmac("sha256", secret).update("postbird-fingerprint").digest("hex").slice(0, 12) : null;
}
