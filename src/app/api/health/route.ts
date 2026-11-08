import { NextResponse } from "next/server";
import { isDbConfigured, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Simple health check for uptime monitors. Exposes no secrets. */
export async function GET() {
  if (!isDbConfigured()) return NextResponse.json({ ok: false, database: "not configured" }, { status: 503 });
  try {
    const [r] = await sql<{ active: number; last_sync: Date | null }[]>`
      select (select count(*)::int from jobs where status = 'active') as active,
             (select max(finished_at) from sync_runs where status in ('success', 'partial')) as last_sync`;
    return NextResponse.json({ ok: true, activeJobs: r.active, lastSuccessfulSync: r.last_sync });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable or schema missing" }, { status: 503 });
  }
}
