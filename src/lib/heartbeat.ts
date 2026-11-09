/**
 * The daily job's heartbeat (server only). At the end of a successful daily
 * run (scripts/digest.ts in GitHub Actions, or /api/cron/digest) the time and
 * the billing safety counts are stored in `settings`, so Admin → Overview can
 * warn when the run stopped (no run for DAILY_JOB_STALE_HOURS), and
 * /api/health can report a plain "daily job fresh" yes/no for uptime monitors.
 * The counts are only shown to the owner, never on the public health check.
 */
import { sql, type Db } from "@/lib/db";
import type { BillingSafetyResult } from "@/lib/billing/subscriptions";

export const DAILY_JOB_KEY = "last_daily_job_at";
export const BILLING_SAFETY_KEY = "last_billing_safety";
/** The job runs once a day; past this many hours without a run, it has stopped. */
export const DAILY_JOB_STALE_HOURS = 26;

/** Whether a run at `at` is recent enough. Pure, so it is unit-tested. */
export function dailyJobFresh(at: Date | string | null, now = Date.now()): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && now - t <= DAILY_JOB_STALE_HOURS * 3600_000;
}

/** Stores the heartbeat and this run's billing safety counts (call only after a successful run). */
export async function recordDailyJob(billing: BillingSafetyResult, db: Db = sql): Promise<void> {
  const counts = JSON.stringify(billing);
  await db`
    insert into settings (key, value, updated_at) values
      (${DAILY_JOB_KEY}, ${new Date().toISOString()}, now()),
      (${BILLING_SAFETY_KEY}, ${counts}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

export type DailyJobStatus = { at: Date | null; billing: BillingSafetyResult | null };

/** The last successful run, if any (Admin → Overview). */
export async function readDailyJob(db: Db = sql): Promise<DailyJobStatus> {
  const rows = await db<{ key: string; value: string }[]>`
    select key, value from settings where key in (${DAILY_JOB_KEY}, ${BILLING_SAFETY_KEY})`;
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const rawAt = get(DAILY_JOB_KEY);
  const at = rawAt && Number.isFinite(Date.parse(rawAt)) ? new Date(rawAt) : null;
  let billing: BillingSafetyResult | null = null;
  try {
    billing = JSON.parse(get(BILLING_SAFETY_KEY) ?? "null");
  } catch {
    billing = null;
  }
  return { at, billing };
}
