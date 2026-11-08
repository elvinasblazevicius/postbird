import { sql } from "@/lib/db";
import { deleteFeedAction, syncNowAction, updateFeedAction } from "../actions";
import { requireAdmin } from "../guard";
import { AdminShell, Card, fmtDateTime, inputCls, StatusPill } from "../ui";
import { AddFeedForm } from "./add-feed-form";

export const dynamic = "force-dynamic";

type FeedRow = {
  id: number; name: string; url: string; default_organization: string | null; content_policy: string; is_active: boolean; from_env: boolean;
  last_synced_at: Date | null; last_status: string | null; last_error: string | null; last_item_count: number | null; active_jobs: number;
};

const POLICY_HELP: Record<string, string> = {
  none: "Title, organization, location, dates and link only",
  excerpt: "Plus a ~300-character summary",
  full: "Plus the full description",
};

/** Hide secret tokens that some feed URLs contain. */
function maskUrl(url: string) {
  return url.replace(/([?&](?:token|key|apikey|access_token|T)=)[^&]+/gi, "$1••••");
}

export default async function FeedsPage() {
  await requireAdmin();
  const feeds = await sql<FeedRow[]>`
    select f.*, (select count(*)::int from job_sources s join jobs j on j.id = s.job_id where s.feed_id = f.id and j.status = 'active') as active_jobs
    from feeds f order by f.is_active desc, f.id`;

  return (
    <AdminShell
      title="Feeds"
      active="/admin/feeds"
      actions={
        <form action={syncNowAction}>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent">Sync now</button>
        </form>
      }
    >
      <Card>
        <h2 className="text-lg font-semibold text-ink">Add an Inoreader feed</h2>
        <p className="mt-1 text-sm text-slate">
          In Inoreader, right-click a folder or tag → Properties → Automations → turn on Output feeds, then copy the RSS or JSON address here.
          The feed is checked before it&apos;s saved.
        </p>
        <div className="mt-4"><AddFeedForm /></div>
      </Card>

      <div className="mt-8 space-y-4">
        {feeds.map((f) => (
          <Card key={f.id}>
            <form action={updateFeedAction} className="grid gap-4 lg:grid-cols-[1fr_1fr_14rem]">
              <input type="hidden" name="id" value={f.id} />
              <div>
                <label className="mb-1 block text-xs font-medium text-slate" htmlFor={`n-${f.id}`}>Name</label>
                <input id={`n-${f.id}`} name="name" defaultValue={f.name} className={inputCls} />
                <p className="mt-2 break-all text-xs text-slate">{maskUrl(f.url)}</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate" htmlFor={`o-${f.id}`}>Organization for every item (only for single-employer feeds)</label>
                <input id={`o-${f.id}`} name="default_organization" defaultValue={f.default_organization ?? ""} placeholder="Leave empty for mixed feeds" className={inputCls} />
                <label className="mb-1 mt-3 block text-xs font-medium text-slate" htmlFor={`p-${f.id}`}>What may be republished</label>
                <select id={`p-${f.id}`} name="content_policy" defaultValue={f.content_policy} className={inputCls}>
                  {Object.entries(POLICY_HELP).map(([k, v]) => <option key={k} value={k}>{k}: {v}</option>)}
                </select>
              </div>
              <div className="flex flex-col justify-between gap-3">
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    {f.is_active ? <StatusPill status={f.last_status ?? "pending"} /> : <StatusPill status="skipped" />}
                    <span className="text-slate">{f.active_jobs} active jobs</span>
                  </div>
                  <div className="mt-1 text-xs text-slate">Last read {fmtDateTime(f.last_synced_at)}{f.last_item_count !== null ? `, ${f.last_item_count} items` : ""}</div>
                  {f.last_error ? <div className="mt-1 text-xs text-[#9b1c1c]">{f.last_error}</div> : null}
                  {f.from_env ? <div className="mt-1 text-xs text-slate">Added from INOREADER_FEED_URLS</div> : null}
                </div>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="is_active" defaultChecked={f.is_active} className="h-4 w-4 accent-[var(--accent)]" /> Import this feed
                </label>
                <button className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-accent">Save</button>
              </div>
            </form>
            <form action={deleteFeedAction} className="mt-3 border-t border-rule pt-3 text-right">
              <input type="hidden" name="id" value={f.id} />
              <button className="text-sm text-[#9b1c1c] hover:underline">
                {f.from_env ? "Turn off (it's set in environment variables)" : "Remove feed"}
              </button>
              <span className="ml-2 text-xs text-slate">Jobs already imported stay until they close.</span>
            </form>
          </Card>
        ))}
        {feeds.length === 0 ? <p className="text-slate">No feeds yet.</p> : null}
      </div>
    </AdminShell>
  );
}
