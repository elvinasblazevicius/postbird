import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyAdminSession } from "@/lib/admin-auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Prevent spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET() {
  if (!(await verifyAdminSession((await cookies()).get(ADMIN_COOKIE)?.value))) {
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }
  const rows = await sql<Record<string, unknown>[]>`
    select email, status, wants_alerts, premium_waitlist, plan, source, preferences, waitlist_note, attribution, created_at, confirmed_at, unsubscribed_at
    from subscribers order by id`;
  const head = ["email", "status", "wants_alerts", "premium_waitlist", "plan", "source", "preferences", "waitlist_note", "attribution", "created_at", "confirmed_at", "unsubscribed_at"];
  const body = [head.join(","), ...rows.map((r) => head.map((h) => csvCell(r[h] instanceof Date ? (r[h] as Date).toISOString() : r[h])).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`,
      // Personal data: never store in browser or CDN caches.
      "cache-control": "no-store",
    },
  });
}
