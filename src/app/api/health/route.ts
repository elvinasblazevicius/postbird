import { NextResponse } from "next/server";
import { isDbConfigured, sql } from "@/lib/db";
import { DAILY_JOB_KEY, dailyJobFresh } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Simple health check for uptime monitors. Exposes no secrets and no counts about subscribers:
 * dailyJobFresh is only whether the daily job (emails, billing safety) succeeded in the last 26 hours.
 * HTTP 503 (with the same JSON) when the database can't be reached or the daily job is stale, so a
 * plain status-code monitor catches a stopped daily job too (README, Admin).
 */
export async function GET() {
  if (!isDbConfigured()) return NextResponse.json({ ok: false, database: "not configured" }, { status: 503 });
  try {
    const [r] = await sql<{ active: number; last_sync: Date | null; daily_job: string | null }[]>`
      select (select count(*)::int from jobs where status = 'active') as active,
             (select max(finished_at) from sync_runs where status in ('success', 'partial')) as last_sync,
             (select value from settings where key = ${DAILY_JOB_KEY}) as daily_job`;
    const fresh = dailyJobFresh(r.daily_job);
    return NextResponse.json(
      { ok: true, activeJobs: r.active, lastSuccessfulSync: r.last_sync, dailyJobFresh: fresh },
      { status: fresh ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable or schema missing" }, { status: 503 });
  }
}
