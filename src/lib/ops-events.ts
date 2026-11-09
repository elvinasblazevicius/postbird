/**
 * Unexpected errors, shown on Admin → Overview (server only). The Paddle
 * webhook and the scheduled jobs (import, emails) record one here when they
 * fail in a way they don't handle themselves, so a problem shows up without an
 * external monitoring service. One open row per source and message (a repeat
 * counts up); the message must not contain personal data (no addresses, no
 * payloads). See db/migrations/012_ops_and_canonical_email.sql.
 */
import { sql } from "@/lib/db";

export type OpsSource = "webhook" | "sync" | "emails";

/** Records (or counts again) an unexpected error. Never throws: recording must not hide the original error. */
export async function recordOpsEvent(source: OpsSource, message: string): Promise<void> {
  // Anything shaped like an email address is masked, in case an error message quoted one.
  const msg = (message || "unknown error").replace(/[^\s@<>"'()]+@[^\s@<>"'()]+/g, "[address]").replace(/\s+/g, " ").trim().slice(0, 500);
  try {
    await sql`
      insert into ops_events (source, message) values (${source}, ${msg})
      on conflict (source, message) where resolved_at is null
      do update set count = ops_events.count + 1, last_at = now()`;
  } catch (e) {
    console.error("ops event not recorded", (e as Error).message);
  }
}

export type OpsEvent = { id: number; source: OpsSource; message: string; count: number; first_at: Date; last_at: Date };

/** The open ones, newest first (Admin → Overview). Empty before migration 012. */
export async function openOpsEvents(limit = 20): Promise<OpsEvent[]> {
  return sql<OpsEvent[]>`
    select id::int as id, source, message, count, first_at, last_at from ops_events
    where resolved_at is null order by last_at desc limit ${limit}`.catch(() => []);
}

export async function resolveOpsEvent(id: number): Promise<void> {
  await sql`update ops_events set resolved_at = now() where id = ${id} and resolved_at is null`;
}

/** Resolved rows are kept 90 days (called by the scheduled clean-up). */
export async function purgeOpsEvents(): Promise<void> {
  await sql`delete from ops_events where resolved_at < now() - interval '90 days'`;
}
