import Link from "next/link";
import { sql } from "@/lib/db";
import { syncNowAction } from "../actions";
import { requireAdmin } from "../guard";
import { AdminShell, fmtDateTime, StatusPill, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  await requireAdmin();
  const runs = await sql<{
    id: number; trigger: string; status: string; started_at: Date; finished_at: Date | null; feeds_total: number; feeds_failed: number;
    items_seen: number; jobs_created: number; jobs_updated: number; jobs_unchanged: number; duplicates: number; items_failed: number; jobs_expired: number; message: string | null;
  }[]>`select * from sync_runs order by id desc limit 100`;
  return (
    <AdminShell
      title="Import history"
      active="/admin/imports"
      actions={<form action={syncNowAction}><button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent">Sync now</button></form>}
    >
      <Table head={["Run", "Started", "Status", "Feeds", "Items", "New", "Updated", "Duplicates", "Failed", "Closed", "Note"]}>
        {runs.map((r) => (
          <tr key={r.id} className="align-top">
            <td className="px-4 py-2"><Link className="text-accent hover:underline" href={`/admin/imports/${r.id}`}>#{r.id}</Link><div className="text-xs text-slate">{r.trigger}</div></td>
            <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(r.started_at)}<div className="text-xs text-slate">{r.finished_at ? `${Math.max(1, Math.round((+new Date(r.finished_at) - +new Date(r.started_at)) / 1000))} s` : "running"}</div></td>
            <td className="px-4 py-2"><StatusPill status={r.status} /></td>
            <td className="px-4 py-2 tabular-nums">{r.feeds_total - r.feeds_failed}/{r.feeds_total}</td>
            <td className="px-4 py-2 tabular-nums">{r.items_seen}</td>
            <td className="px-4 py-2 tabular-nums">{r.jobs_created}</td>
            <td className="px-4 py-2 tabular-nums">{r.jobs_updated}</td>
            <td className="px-4 py-2 tabular-nums">{r.duplicates}</td>
            <td className="px-4 py-2 tabular-nums">{r.items_failed}</td>
            <td className="px-4 py-2 tabular-nums">{r.jobs_expired}</td>
            <td className="max-w-xs px-4 py-2 text-xs text-slate">{r.message}</td>
          </tr>
        ))}
        {runs.length === 0 ? <tr><td colSpan={11} className="px-4 py-3 text-slate">No imports yet.</td></tr> : null}
      </Table>
    </AdminShell>
  );
}
