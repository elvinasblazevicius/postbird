import Link from "next/link";
import { ALL_CATEGORIES } from "@/config/categories";
import { sql } from "@/lib/db";
import { formatDate, jobPath, locationLabel } from "@/lib/site";
import { setJobCategoryAction, setJobStatusAction } from "../actions";
import { requireAdmin } from "../guard";
import { AdminShell, inputCls, StatusPill, Table } from "../ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; status?: string; page?: string }> };

const STATUSES = ["active", "expired", "archived", "removed"];

export default async function AdminJobsPage({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim() || null;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : null;
  const page = Math.min(Math.max(1, Math.floor(Number(sp.page)) || 1), 100_000);
  const like = q ? `%${q.replace(/[%_\\]/g, "")}%` : null;
  const rows = await sql<{
    id: number; slug: string; title: string; org_name: string | null; city: string | null; country_code: string | null; location_text: string | null;
    is_remote: boolean | null; category: string; category_locked: boolean; status: string; deadline: string | null; apply_host: string; is_demo: boolean; sources: number;
  }[]>`
    select j.id, j.slug, j.title, o.name as org_name, j.city, j.country_code, j.location_text, j.is_remote, j.category, j.category_locked,
           j.status, j.deadline::text as deadline, j.apply_host, j.is_demo,
           (select count(*)::int from job_sources s where s.job_id = j.id) as sources
    from jobs j left join organizations o on o.id = j.organization_id
    where (${status}::text is null or j.status = ${status})
      and (${like}::text is null or j.title ilike ${like} or o.name ilike ${like} or j.apply_host ilike ${like})
    order by j.first_seen_at desc, j.id desc
    limit 50 offset ${(page - 1) * 50}`;

  return (
    <AdminShell title="Listings" active="/admin/jobs">
      <form className="flex flex-wrap gap-3" method="get">
        <input name="q" defaultValue={q ?? ""} placeholder="Search title, organization or website" className={`${inputCls} max-w-sm`} />
        <select name="status" defaultValue={status ?? ""} className={`${inputCls} max-w-[12rem]`}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <p className="mt-3 text-sm text-slate">Removing a listing hides it everywhere and stops future imports from bringing it back. Changing a category locks it against automatic changes.</p>

      <div className="mt-4">
        <Table head={["Listing", "Status", "Category", "Action"]}>
          {rows.map((j) => (
            <tr key={j.id} className="align-top">
              <td className="max-w-md px-4 py-3">
                <Link href={jobPath(j)} className="font-medium text-accent hover:underline">{j.title}</Link>
                <div className="text-xs text-slate">
                  {j.org_name ?? "Organization not specified"} | {locationLabel(j)} | closes {formatDate(j.deadline)} | {j.apply_host}
                  {j.sources > 1 ? ` | merged from ${j.sources} feeds` : ""}{j.is_demo ? " | DEMO" : ""}
                </div>
              </td>
              <td className="px-4 py-3"><StatusPill status={j.status} /></td>
              <td className="px-4 py-3">
                <form action={setJobCategoryAction} className="flex gap-2">
                  <input type="hidden" name="id" value={j.id} />
                  <select name="category" defaultValue={j.category} className={`${inputCls} py-1`} aria-label="Category">
                    {ALL_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                  <button className="text-xs text-accent hover:underline">Set</button>
                </form>
                {j.category_locked ? <div className="mt-1 text-xs text-slate">set by admin</div> : null}
              </td>
              <td className="px-4 py-3">
                <form action={setJobStatusAction}>
                  <input type="hidden" name="id" value={j.id} />
                  {j.status === "removed" ? (
                    <><input type="hidden" name="op" value="restore" /><button className="text-sm text-accent hover:underline">Restore</button></>
                  ) : (
                    <><input type="hidden" name="op" value="remove" /><button className="text-sm text-[#9b1c1c] hover:underline">Remove</button></>
                  )}
                </form>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-3 text-slate">No listings match.</td></tr> : null}
        </Table>
      </div>
      <div className="mt-4 flex gap-3 text-sm">
        {page > 1 ? <Link className="text-accent hover:underline" href={`/admin/jobs?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(page - 1) })}`}>Previous</Link> : null}
        {rows.length === 50 ? <Link className="text-accent hover:underline" href={`/admin/jobs?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(page + 1) })}`}>Next</Link> : null}
      </div>
    </AdminShell>
  );
}
