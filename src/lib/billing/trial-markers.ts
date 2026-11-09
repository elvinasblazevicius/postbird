/**
 * One free trial per email address, kept after the address itself is deleted
 * (server only). When the retention clean-up deletes an address that had a
 * plan, a one-way code of it is stored in trial_markers for 24 months; the
 * checkout and the webhook treat a marked address as one that had a trial.
 *
 * The code is HMAC-SHA256(server secret, normalized address): it can't be
 * turned back into the address, and without the secret nobody can test an
 * address against the table. The secret is ANALYTICS_SALT, or CRON_SECRET when
 * that isn't set (the same order as the rate limiter's salt). Changing that
 * secret makes every existing marker stop matching (see README → section 6).
 */
import { createHmac } from "node:crypto";
import { sql, type Db } from "@/lib/db";

/** How long a marker is kept (privacy policy: 24 months). */
export const TRIAL_MARKER_MONTHS = 24;

function markerSecret(): string {
  return process.env.ANALYTICS_SALT || process.env.CRON_SECRET || "postbird-trial-marker";
}

/** The one-way code of an address (already normalized with normalizeEmail). */
export function trialMarker(email: string): string {
  return createHmac("sha256", markerSecret()).update(`trial-marker|${email.trim().toLowerCase()}`).digest("hex");
}

/** Whether this address had a plan before it was deleted (a marker that hasn't expired). */
export async function hasTrialMarker(email: string, db: Db = sql): Promise<boolean> {
  const [row] = await db`select 1 from trial_markers where hash = ${trialMarker(email)} and expires_at > now()`;
  return Boolean(row);
}

/** The addresses among `emails` that have a marker (one query for a batch). */
export async function markedEmails(emails: string[], db: Db = sql): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const byHash = new Map(emails.map((e) => [trialMarker(e), e]));
  const rows = await db<{ hash: string }[]>`select hash from trial_markers where hash = any(${[...byHash.keys()]}) and expires_at > now()`;
  return new Set(rows.map((r) => byHash.get(r.hash)!));
}

/** Stores (or renews) the markers of these addresses for TRIAL_MARKER_MONTHS. */
export async function writeTrialMarkers(db: Db, emails: string[]): Promise<void> {
  const hashes = [...new Set(emails.map(trialMarker))];
  if (!hashes.length) return;
  await db`
    insert into trial_markers (hash, expires_at)
    select h, now() + make_interval(months => ${TRIAL_MARKER_MONTHS}) from unnest(${hashes}::text[]) as h
    on conflict (hash) do update set expires_at = excluded.expires_at`;
}
