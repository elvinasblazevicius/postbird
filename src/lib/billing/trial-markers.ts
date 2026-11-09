/**
 * One free trial per person (server only), kept after the address itself is
 * deleted.
 *
 * Canonical form: for this rule only, an address is compared in its canonical
 * form (canonicalTrialEmail): lowercase, without a "+suffix" in the local part
 * on any domain, and for Gmail without dots in the local part (googlemail.com
 * counts as gmail.com). So name+1@gmail.com and n.a.m.e@googlemail.com are the
 * same person here. Emails are still sent to the address exactly as typed
 * (normalizeEmail in src/lib/subscribers.ts). The subscribers table keeps the
 * canonical form in canonical_email (db/migrations/012, kept up to date by a
 * trigger whose SQL function matches canonicalTrialEmail; a test checks both
 * agree).
 *
 * Markers: when the retention clean-up deletes an address that had a plan
 * (and was confirmed), a one-way code of its canonical form is stored in
 * trial_markers for 24 months; the checkout and the webhook treat a marked
 * address as one that had a trial.
 *
 * The code is HMAC-SHA256(server secret, canonical address): it can't be
 * turned back into the address, and without the secret nobody can test an
 * address against the table. The secret is sharedSecret() (ANALYTICS_SALT, or
 * CRON_SECRET when that isn't set), and the scheduled jobs (which write the
 * markers) and the website (which checks them) must have the same values.
 * With neither set, no marker is written (the job logs an error and keeps the
 * rows that would have needed one) and no address counts as marked. Each run
 * of the clean-up stores the secret's fingerprint in settings
 * ('trial_marker_key_fingerprint'), and Admin → Overview warns when it isn't
 * the website's. Changing the secret makes every existing marker stop
 * matching (see README → section 6).
 */
import { createHmac } from "node:crypto";
import { sql, type Db } from "@/lib/db";
import { secretFingerprint, sharedSecret } from "@/lib/server-secret";

/** How long a marker is kept (privacy policy: 24 months). */
export const TRIAL_MARKER_MONTHS = 24;

/** The settings key under which the scheduled jobs store the fingerprint of the marker secret. */
export const MARKER_FINGERPRINT_KEY = "trial_marker_key_fingerprint";

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The canonical form of an address for the one-trial rule only (never for
 * sending). Must stay identical to the SQL function canonical_trial_email()
 * in db/migrations/012_ops_and_canonical_email.sql.
 */
export function canonicalTrialEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.replace(/\./g, "") || local;
  }
  return `${local}@${domain}`;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(`trial-marker|${value}`).digest("hex");
}

/** The one-way code of an address (its canonical form). null when no secret is set. */
export function trialMarker(email: string): string | null {
  const secret = sharedSecret();
  return secret ? hmac(secret, canonicalTrialEmail(email)) : null;
}

/**
 * The codes an address may have been stored under: its canonical form, and
 * the address as it was normalized before canonical forms existed (markers
 * written before migration 012), when that differs.
 */
function markerCandidates(email: string): string[] {
  const secret = sharedSecret();
  if (!secret) return [];
  const legacy = email.trim().toLowerCase();
  return [...new Set([hmac(secret, canonicalTrialEmail(email)), hmac(secret, legacy)])];
}

/** Whether this address had a plan before it was deleted (a marker that hasn't expired). False when no secret is set. */
export async function hasTrialMarker(email: string, db: Db = sql): Promise<boolean> {
  const hashes = markerCandidates(email);
  if (!hashes.length) return false;
  const [row] = await db`select 1 from trial_markers where hash = any(${hashes}) and expires_at > now()`;
  return Boolean(row);
}

/** The addresses among `emails` that have a marker (one query for a batch). */
export async function markedEmails(emails: string[], db: Db = sql): Promise<Set<string>> {
  if (!emails.length || !sharedSecret()) return new Set();
  const byHash = new Map<string, string>();
  for (const e of emails) for (const h of markerCandidates(e)) byHash.set(h, e);
  const rows = await db<{ hash: string }[]>`select hash from trial_markers where hash = any(${[...byHash.keys()]}) and expires_at > now()`;
  return new Set(rows.map((r) => byHash.get(r.hash)!));
}

/**
 * Stores (or renews) the markers of these addresses for TRIAL_MARKER_MONTHS.
 * Returns false (and writes nothing) when no secret is set.
 */
export async function writeTrialMarkers(db: Db, emails: string[]): Promise<boolean> {
  const secret = sharedSecret();
  if (!secret) return false;
  const hashes = [...new Set(emails.map((e) => hmac(secret, canonicalTrialEmail(e))))];
  if (!hashes.length) return true;
  await db`
    insert into trial_markers (hash, expires_at)
    select h, now() + make_interval(months => ${TRIAL_MARKER_MONTHS}) from unnest(${hashes}::text[]) as h
    on conflict (hash) do update set expires_at = excluded.expires_at`;
  return true;
}

/** Stores the fingerprint of the secret this process uses for markers (called by the scheduled clean-up). */
export async function storeMarkerFingerprint(db: Db = sql): Promise<void> {
  const fp = secretFingerprint();
  if (!fp) return;
  await db`
    insert into settings (key, value) values (${MARKER_FINGERPRINT_KEY}, ${fp})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

export type MarkerKeyCheck =
  | { status: "ok" | "unknown" }
  | { status: "missing" }
  | { status: "mismatch"; storedAt: Date };

/**
 * Admin → Overview: does the website use the same marker secret as the
 * scheduled jobs? "unknown" until a scheduled clean-up has stored its
 * fingerprint; "missing" when the website has no secret at all.
 */
export async function checkMarkerKey(db: Db = sql): Promise<MarkerKeyCheck> {
  const own = secretFingerprint();
  if (!own) return { status: "missing" };
  const [row] = await db<{ value: string; updated_at: Date }[]>`select value, updated_at from settings where key = ${MARKER_FINGERPRINT_KEY}`;
  if (!row) return { status: "unknown" };
  return row.value === own ? { status: "ok" } : { status: "mismatch", storedAt: row.updated_at };
}

/**
 * Whether the one-trial rule applies to this address because of something
 * other than its own row: a trial marker, or another subscriber row with the
 * same canonical form that had a plan while confirmed (the SQL function
 * had_plan(), the same rule as hadTrialBefore).
 * `selfId`: the address's own row, left out (its history is checked by the
 * caller).
 */
export async function trialUsedElsewhere(email: string, selfId: number | null = null, db: Db = sql): Promise<boolean> {
  if (await hasTrialMarker(email, db)) return true;
  const [row] = await db`
    select 1 from subscribers
    where canonical_email = ${canonicalTrialEmail(email)} and id <> ${selfId ?? 0}
      and had_plan(subscribers)
    limit 1`;
  return Boolean(row);
}

/** trialUsedElsewhere for a batch of subscriber rows: the ids it applies to (two queries). */
export async function trialUsedElsewhereIds(rows: { id: number; email: string }[], db: Db = sql): Promise<Set<number>> {
  if (!rows.length) return new Set();
  const marked = await markedEmails(rows.map((r) => r.email), db);
  const canon = rows.map((r) => canonicalTrialEmail(r.email));
  const others = await db<{ id: number }[]>`
    select r.id::int as id
    from unnest(${rows.map((r) => r.id)}::bigint[], ${canon}::text[]) as r(id, canonical_email)
    where exists (
      select 1 from subscribers s
      where s.canonical_email = r.canonical_email and s.id <> r.id and had_plan(s))`;
  const out = new Set(others.map((o) => o.id));
  for (const r of rows) if (marked.has(r.email)) out.add(r.id);
  return out;
}
