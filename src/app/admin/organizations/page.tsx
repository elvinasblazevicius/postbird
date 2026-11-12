import Link from "next/link";
import { sql } from "@/lib/db";
import { isUnitCode, knownOrgByName } from "@/lib/feeds/extract";
import { requireAdmin } from "../guard";
import { AdminShell, fmtDateTime, Table } from "../ui";

export const dynamic = "force-dynamic";

/** Days since an organization's newest vacancy: up to ACTIVE_DAYS is active, up to QUIET_DAYS quiet, beyond that stale. */
const ACTIVE_DAYS = 30;
const QUIET_DAYS = 90;

type Health = "active" | "quiet" | "stale";
const HEALTH: Record<Health, { label: string; tone: string; dot: string; meaning: string }> = {
  active: { label: "Active", tone: "bg-remote-bg text-remote", dot: "bg-remote", meaning: `new vacancy in the last ${ACTIVE_DAYS} days` },
  quiet: { label: "Quiet", tone: "bg-signal-bg text-signal", dot: "bg-signal", meaning: `newest vacancy ${ACTIVE_DAYS + 1}–${QUIET_DAYS} days ago` },
  stale: { label: "Stale", tone: "bg-[#fde8e8] text-[#9b1c1c]", dot: "bg-[#c53030]", meaning: `nothing new for over ${QUIET_DAYS} days` },
};
const ORDER: Health[] = ["stale", "quiet", "active"];

type Props = { searchParams: Promise<{ health?: string; q?: string }> };

export default async function AdminOrganizationsPage({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const only = ORDER.includes(sp.health as Health) ? (sp.health as Health) : null;
  const q = typeof sp.q === "string" ? sp.q.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 100) : "";

  const rows = await sql<{ id: number; slug: string; name: string; org_type: string | null; open: number; total: number; newest: Date | null; last_in_feed: Date | null; days: number | null }[]>`
    select o.id::int as id, o.slug, o.name, o.org_type,
           count(j.id) filter (where j.status = 'active')::int as open,
           count(j.id)::int as total,
           max(j.first_seen_at) as newest,
           max(j.last_seen_at) as last_in_feed,
           floor(extract(epoch from now() - max(j.first_seen_at)) / 86400)::int as days
      from organizations o
      left join jobs j on j.organization_id = o.id and not j.is_demo
     group by o.id
     order by max(j.first_seen_at) asc nulls first, o.name`;

  const health = (days: number | null): Health => days === null || days > QUIET_DAYS ? "stale" : days > ACTIVE_DAYS ? "quiet" : "active";
  const all = rows.map((r) => {
    const known = Boolean(knownOrgByName(r.name));
    return { ...r, health: health(r.days), known, code: isUnitCode(r.name) };
  });
  const counts = Object.fromEntries(ORDER.map((h) => [h, all.filter((r) => r.health === h).length])) as Record<Health, number>;
  const needle = q.toLowerCase();
  const shown = all.filter((r) => (!only || r.health === only) && (!needle || r.name.toLowerCase().includes(needle) || r.slug.includes(needle)));
  const link = (h: Health | null) => `/admin/organizations${h || q ? `?${new URLSearchParams({ ...(h ? { health: h } : {}), ...(q ? { q } : {}) })}` : ""}`;

  return (
    <AdminShell title="Organizations" active="/admin/organizations">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show">
        <Link href={link(null)} aria-current={!only ? "true" : undefined} className={`rounded-full border px-3 py-1 text-sm ${!only ? "border-ink text-ink" : "border-rule text-slate hover:text-ink"}`}>
          All {all.length}
        </Link>
        {ORDER.map((h) => (
          <Link key={h} href={link(h)} aria-current={only === h ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${only === h ? "border-ink text-ink" : "border-rule text-slate hover:text-ink"}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${HEALTH[h].dot}`} aria-hidden="true" />
            {HEALTH[h].label} {counts[h]}
          </Link>
        ))}
        <form method="get" className="ml-auto flex gap-2">
          {only ? <input type="hidden" name="health" value={only} /> : null}
          <input name="q" defaultValue={q} placeholder="Find an organization" className="w-56 rounded-md border border-rule bg-paper px-3 py-1.5 text-sm text-ink" />
        </form>
      </div>
      <p className="mt-3 text-sm text-slate">
        {ORDER.map((h, i) => <span key={h}>{i ? " · " : ""}<strong className="font-medium text-ink">{HEALTH[h].label}</strong>: {HEALTH[h].meaning}</span>)}.
        {" "}Stalest first. &ldquo;From feeds&rdquo; means the name came from a feed, not the known-organizations list (src/config/organizations.ts); check those for odd names.
        An organization disappears by itself once none of its vacancies are kept.
      </p>

      <div className="mt-4">
        <Table head={["Organization", "Status", "Open now", "Newest vacancy", "Last in a feed", "Kept vacancies"]}>
          {shown.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="max-w-sm px-4 py-3">
                <Link href={`/admin/jobs?q=${encodeURIComponent(r.name)}`} className="font-medium text-accent hover:underline">{r.name}</Link>
                <div className="text-xs text-slate">
                  {r.org_type ?? "Type not set"} | {r.known ? "known list" : "from feeds"}
                  {r.code ? <span className="font-medium text-[#9b1c1c]"> | looks like an office code, not a name</span> : null}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${HEALTH[r.health].tone}`}>
                  <span className={`h-2 w-2 rounded-full ${HEALTH[r.health].dot}`} aria-hidden="true" />{HEALTH[r.health].label}
                </span>
              </td>
              <td className="px-4 py-3 tabular-nums">{r.open}</td>
              <td className="px-4 py-3 text-slate">{r.newest ? <>{fmtDateTime(r.newest)}<div className="text-xs">{r.days === 0 ? "today" : `${r.days} days ago`}</div></> : "never"}</td>
              <td className="px-4 py-3 text-slate">{r.last_in_feed ? fmtDateTime(r.last_in_feed) : "—"}</td>
              <td className="px-4 py-3 tabular-nums text-slate">{r.total}</td>
            </tr>
          ))}
        </Table>
        {shown.length === 0 ? <p className="mt-3 text-sm text-slate">No organizations match.</p> : null}
      </div>
    </AdminShell>
  );
}
