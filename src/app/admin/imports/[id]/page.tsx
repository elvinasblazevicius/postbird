import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { jobPath, parseId } from "@/lib/site";
import { requireAdmin } from "../../guard";
import { AdminShell, Card, fmtDateTime, StatusPill, Table } from "../../ui";

export const dynamic = "force-dynamic";

const OUTCOMES = ["feed_error", "failed", "skipped", "duplicate", "created", "updated"];

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ outcome?: string }> };

export default async function ImportRunPage({ params, searchParams }: Props) {
  await requireAdmin();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const outcome = (await searchParams).outcome;
  const [run] = await sql<{ id: number; status: string; trigger: string; started_at: Date; finished_at: Date | null; message: string | null; jobs_created: number; jobs_updated: number; jobs_unchanged: number; duplicates: number; items_failed: number; feeds_failed: number; jobs_expired: number }[]>`
    select * from sync_runs where id = ${id}`;
  if (!run) notFound();
  const counts = await sql<{ outcome: string; n: number }[]>`select outcome, count(*)::int as n from sync_items where run_id = ${id} group by outcome`;
  const items = await sql<{ id: number; outcome: string; title: string | null; url: string | null; message: string | null; job_id: number | null; job_slug: string | null; feed_name: string | null }[]>`
    select i.id, i.outcome, i.title, i.url, i.message, i.job_id, j.slug as job_slug, f.name as feed_name
    from sync_items i left join jobs j on j.id = i.job_id left join feeds f on f.id = i.feed_id
    where i.run_id = ${id} and (${outcome ?? null}::text is null or i.outcome = ${outcome ?? null})
    order by array_position(${OUTCOMES}::text[], i.outcome), i.id limit 500`;

  return (
    <AdminShell title={`Import #${run.id}`} active="/admin/imports">
      <Card>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusPill status={run.status} />
          <span>{run.trigger}</span>
          <span className="text-slate">{fmtDateTime(run.started_at)} → {fmtDateTime(run.finished_at)}</span>
        </div>
        <p className="mt-3 text-sm text-ink">
          {run.jobs_created} new, {run.jobs_updated} updated, {run.jobs_unchanged} unchanged, {run.duplicates} duplicates merged, {run.items_failed} failed items, {run.feeds_failed} feed errors, {run.jobs_expired} listings closed.
        </p>
        {run.message ? <p className="mt-2 text-sm text-signal">{run.message}</p> : null}
      </Card>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link href={`/admin/imports/${id}`} className={`rounded-md px-3 py-1 ${!outcome ? "bg-brand text-white" : "bg-paper text-slate"}`}>All</Link>
        {OUTCOMES.map((o) => {
          const n = counts.find((c) => c.outcome === o)?.n ?? 0;
          return (
            <Link key={o} href={`/admin/imports/${id}?outcome=${o}`} className={`rounded-md px-3 py-1 ${outcome === o ? "bg-brand text-white" : "bg-paper text-slate"}`}>
              {o.replace("_", " ")} ({n})
            </Link>
          );
        })}
      </div>

      <div className="mt-4">
        <Table head={["Outcome", "Item", "Feed", "Details"]}>
          {items.map((i) => (
            <tr key={i.id} className="align-top">
              <td className="px-4 py-2"><StatusPill status={i.outcome} /></td>
              <td className="max-w-md px-4 py-2">
                {i.job_id && i.job_slug ? <Link href={jobPath({ id: i.job_id, slug: i.job_slug })} className="text-accent hover:underline">{i.title || "(no title)"}</Link> : <span>{i.title || "(no title)"}</span>}
                {i.url ? <div className="break-all text-xs text-slate">{i.url}</div> : null}
              </td>
              <td className="px-4 py-2 text-slate">{i.feed_name ?? "—"}</td>
              <td className="max-w-sm px-4 py-2 text-slate">{i.message ?? ""}</td>
            </tr>
          ))}
          {items.length === 0 ? <tr><td colSpan={4} className="px-4 py-3 text-slate">Nothing to show. Unchanged items aren&apos;t listed individually.</td></tr> : null}
        </Table>
      </div>
    </AdminShell>
  );
}
