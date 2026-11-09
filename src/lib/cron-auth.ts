import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Scheduled jobs must send "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does this automatically).
 * Kept free of heavy imports so routes can reject unauthorized calls before loading anything else.
 */
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Compare fixed-length digests so the comparison doesn't reveal the secret's length.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return given.length > 0 && timingSafeEqual(digest(given), digest(secret));
}
