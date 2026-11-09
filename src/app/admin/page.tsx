import siteConfig from "@site-config";
import Link from "next/link";
import { categoryName } from "@/lib/site";
import { sql } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { syncNowAction } from "./actions";
import { requireAdmin } from "./guard";
import { AdminShell, Card, fmtDateTime, olderThanHours, Stat, StatusPill, Table } from "./ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ days?: string }> };

export default async function AdminHome({ searchParams }: Props) {
  await requireAdmin();
  const daysRaw = Number((await searchParams).days);
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

  const [[jobs], [subs], lastRuns, [feeds], [ev], daily, topCats, topOrgs, topSearches, topJobs, referrers] = await Promise.all([
    sql<{ active: number; closed: number; removed: number; new7: number; demo: number }[]>`
      select count(*) filter (where status = 'active')::int as active,
             count(*) filter (where status in ('expired', 'archived'))::int as closed,
             count(*) filter (where status = 'removed')::int as removed,
             count(*) filter (where status = 'active' and first_seen_at >= now() - interval '7 days')::int as new7,
             count(*) filter (where is_demo)::int as demo
      from jobs`,
    sql<{ alerts: number; pending: number; waitlist: number; waitlist_pending: number; unsub: number }[]>`
      select count(*) filter (where status = 'confirmed' and wants_alerts)::int as alerts,
             count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'confirmed' and premium_waitlist)::int as waitlist,
             count(*) filter (where status = 'pending' and premium_waitlist)::int as waitlist_pending,
             count(*) filter (where status = 'unsubscribed')::int as unsub
      from subscribers`,
    sql<{ id: number; status: string; trigger: string; started_at: Date; jobs_created: number; jobs_updated: number; duplicates: number; items_failed: number; feeds_failed: number; message: string | null }[]>`
      select id, status, trigger, started_at, jobs_created, jobs_updated, duplicates, items_failed, feeds_failed, message
      from sync_runs order by id desc limit 5`,
    sql<{ total: number; active: number; erroring: number }[]>`
      select count(*)::int as total, count(*) filter (where is_active)::int as active,
             count(*) filter (where is_active and last_status = 'error')::int as erroring from feeds`,
    sql<{ visitors: number; pageviews: number; job_views: number; searches: number; apply: number; cta: number; alert_signups: number; waitlist_signups: number; confirmed: number }[]>`
      select count(distinct visitor) filter (where type = 'pageview')::int as visitors,
             count(*) filter (where type = 'pageview')::int as pageviews,
             count(*) filter (where type = 'job_view')::int as job_views,
             count(*) filter (where type = 'search')::int as searches,
             count(*) filter (where type = 'apply_click')::int as apply,
             count(*) filter (where type = 'premium_cta_click')::int as cta,
             count(*) filter (where type = 'alert_signup')::int as alert_signups,
             count(*) filter (where type = 'waitlist_signup')::int as waitlist_signups,
             count(*) filter (where type = 'alert_confirmed')::int as confirmed
      from events where created_at >= now() - make_interval(days => ${days})`,
    sql<{ day: string; visitors: number; apply: number }[]>`
      select to_char(d, 'YYYY-MM-DD') as day,
             (select count(distinct visitor)::int from events e where e.type = 'pageview' and e.created_at >= d and e.created_at < d + interval '1 day') as visitors,
             (select count(*)::int from events e where e.type = 'apply_click' and e.created_at >= d and e.created_at < d + interval '1 day') as apply
      from generate_series(date_trunc('day', now()) - make_interval(days => ${days - 1}), date_trunc('day', now()), interval '1 day') d
      order by d`,
    sql<{ category: string; views: number; applies: number }[]>`
      select j.category, count(*) filter (where e.type = 'job_view')::int as views, count(*) filter (where e.type = 'apply_click')::int as applies
      from events e join jobs j on j.id = e.job_id
      where e.type in ('job_view', 'apply_click') and e.created_at >= now() - make_interval(days => ${days})
      group by j.category order by views desc limit 8`,
    sql<{ name: string; views: number; applies: number }[]>`
      select coalesce(o.name, 'Not specified') as name, count(*) filter (where e.type = 'job_view')::int as views, count(*) filter (where e.type = 'apply_click')::int as applies
      from events e join jobs j on j.id = e.job_id left join organizations o on o.id = j.organization_id
      where e.type in ('job_view', 'apply_click') and e.created_at >= now() - make_interval(days => ${days})
      group by 1 order by views desc limit 8`,
    sql<{ q: string; n: number }[]>`
      select lower(props->>'q') as q, count(*)::int as n from events
      where type = 'search' and props->>'q' is not null and created_at >= now() - make_interval(days => ${days})
      group by 1 order by n desc limit 10`,
    sql<{ id: number; title: string; applies: number }[]>`
      select j.id, j.title, count(*)::int as applies from events e join jobs j on j.id = e.job_id
      where e.type = 'apply_click' and e.created_at >= now() - make_interval(days => ${days})
      group by j.id, j.title order by applies desc limit 8`,
    sql<{ referrer: string; visitors: number }[]>`
      select referrer, count(distinct visitor)::int as visitors from events
      where type = 'pageview' and referrer is not null and created_at >= now() - make_interval(days => ${days})
      group by referrer order by visitors desc limit 10`,
  ]);

  const [campaigns, [ct]] = await Promise.all([
    campaignStats(days),
    // Concept test: each ad visitor counted once, "converted" if that same visitor later left an email via the trial form.
    sql<{ visitors: number; converted: number }[]>`
      with landings as (
        select distinct on (visitor) visitor, created_at from events
        where type = 'pageview' and props ? 'campaign' and visitor is not null
        order by visitor, created_at
      )
      select count(*)::int as visitors,
             count(*) filter (where exists (
               select 1 from events e where e.type = 'waitlist_signup' and e.visitor = l.visitor and e.created_at >= l.created_at
             ))::int as converted
      from landings l`,
  ]);
  const test = siteConfig.conceptTest;
  const adVisitors = ct.visitors;
  const adSignups = ct.converted;
  const adRate = adVisitors ? adSignups / adVisitors : 0;
  const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const verdict =
    adVisitors < test.minVisitors
      ? { tone: "bg-mist text-ink", title: "Collecting data", text: `${adVisitors} of ${test.minVisitors} ad visitors so far. Current rate ${pct(adRate)}; no verdict yet.` }
      : adRate >= test.successRate
        ? { tone: "bg-remote-bg text-remote", title: "Passed", text: `${pct(adRate)} of ${adVisitors} ad visitors clicked "Start free trial" and left an email (target ${pct(test.successRate)}). Worth building real billing.` }
        : adRate < test.failRate
          ? { tone: "bg-[#fde8e8] text-[#9b1c1c]", title: "Failed", text: `${pct(adRate)} of ${adVisitors} ad visitors (below ${pct(test.failRate)}). People don't want to pay for alerts at this price or with this message.` }
          : { tone: "bg-signal-bg text-signal", title: "Unclear", text: `${pct(adRate)} of ${adVisitors} ad visitors, between ${pct(test.failRate)} and ${pct(test.successRate)}. Try a different ad message or price before deciding.` };
  const lastOk = lastRuns.find((r) => r.status === "success" || r.status === "partial");
  const warnings: React.ReactNode[] = [];
  if (feeds.active === 0) warnings.push(<>No active feeds. <Link href="/admin/feeds" className="underline">Add your Inoreader feed</Link>.</>);
  if (feeds.erroring) warnings.push(<>{feeds.erroring} feed(s) failed at the last sync. <Link href="/admin/feeds" className="underline">Check feeds</Link>.</>);
  if (!lastOk) warnings.push(<>No successful import yet. Use &quot;Sync now&quot; to run the first one.</>);
  else if (olderThanHours(lastOk.started_at, 8)) warnings.push(<>The last successful import was over 8 hours ago. Check that the scheduled sync (GitHub Actions) is running.</>);
  if (!isEmailConfigured()) warnings.push(<>Email isn&apos;t set up (RESEND_API_KEY missing). Sign-ups are saved but no confirmation or alert emails are sent.</>);
  if (!process.env.CRON_SECRET) warnings.push(<>CRON_SECRET is missing, so the /api/cron addresses are switched off.</>);
  if (jobs.demo) warnings.push(<>{jobs.demo} demo listings are in the database. Remove them with <code>npm run demo:clear</code> before launch.</>);

  const maxV = Math.max(1, ...daily.map((d) => d.visitors));
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

  return (
    <AdminShell
      title="Overview"
      active="/admin"
      actions={
        <form action={syncNowAction}>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent">Sync now</button>
        </form>
      }
    >
      {warnings.length ? (
        <Card className="mb-6 border-[#f0d9b5] bg-signal-bg">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active vacancies" value={jobs.active} hint={`${jobs.new7} new this week; ${jobs.closed} closed; ${jobs.removed} removed`} />
        <Stat label="Alert subscribers" value={subs.alerts} hint={`${subs.pending} awaiting confirmation; ${subs.unsub} unsubscribed`} />
        <Stat label="Premium waitlist" value={subs.waitlist} hint={`${subs.waitlist_pending} more awaiting confirmation`} />
        <Stat label="Feeds" value={`${feeds.active}/${feeds.total}`} hint={lastOk ? `Last import ${fmtDateTime(lastOk.started_at)}` : "Never imported"} />
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Is the site useful? Last {days} days</h2>
        <div className="flex gap-1 text-sm">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/admin?days=${d}`} className={`rounded-md px-3 py-1 ${d === days ? "bg-brand text-white" : "text-slate hover:bg-paper"}`}>{d} days</Link>
          ))}
        </div>
      </div>
      <div className={`mt-4 rounded-xl p-4 ${verdict.tone}`}>
        <div className="text-sm font-medium">Concept test (all time): {verdict.title}</div>
        <div className="mt-1 text-sm">{verdict.text}</div>
        <div className="mt-1 text-xs opacity-80">
          Rule set before launch: pass at {pct(test.successRate)} or more, fail below {pct(test.failRate)}, from at least {test.minVisitors} visitors arriving from ads. Change it in site.config.ts.
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visitors" value={ev.visitors} hint={`${ev.pageviews} page views`} />
        <Stat label="Job views" value={ev.job_views} hint={`${ev.searches} filtered searches`} />
        <Stat label="Apply clicks" value={ev.apply} hint={`${rate(ev.apply, ev.job_views)} of job views`} />
        <Stat label="Premium interest" value={ev.cta} hint={`trial clicks; ${ev.waitlist_signups} left an email (${rate(ev.waitlist_signups, ev.cta)})`} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Stat label="Alert sign-ups" value={ev.alert_signups} hint={`${ev.confirmed} confirmations; ${rate(ev.alert_signups, ev.visitors)} of visitors signed up`} />
        <Card>
          <div className="text-sm text-slate">Daily visitors</div>
          <div className="mt-3 flex h-24 items-end gap-[2px]" role="img" aria-label="Daily visitors chart">
            {daily.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.visitors} visitors, ${d.apply} apply clicks`} className="flex-1 rounded-t bg-accent/70" style={{ height: `${Math.max(2, (d.visitors / maxV) * 100)}%` }} />
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Table head={["Category", "Job views", "Apply clicks"]}>
          {topCats.map((c) => <tr key={c.category}><td className="px-4 py-2">{categoryName(c.category)}</td><td className="px-4 py-2 tabular-nums">{c.views}</td><td className="px-4 py-2 tabular-nums">{c.applies}</td></tr>)}
          {topCats.length === 0 ? <tr><td colSpan={3} className="px-4 py-3 text-slate">No data yet</td></tr> : null}
        </Table>
        <Table head={["Organization", "Job views", "Apply clicks"]}>
          {topOrgs.map((o) => <tr key={o.name}><td className="px-4 py-2">{o.name}</td><td className="px-4 py-2 tabular-nums">{o.views}</td><td className="px-4 py-2 tabular-nums">{o.applies}</td></tr>)}
          {topOrgs.length === 0 ? <tr><td colSpan={3} className="px-4 py-3 text-slate">No data yet</td></tr> : null}
        </Table>
        <Table head={["Top keyword searches", "Searches"]}>
          {topSearches.map((s) => <tr key={s.q}><td className="px-4 py-2">{s.q}</td><td className="px-4 py-2 tabular-nums">{s.n}</td></tr>)}
          {topSearches.length === 0 ? <tr><td colSpan={2} className="px-4 py-3 text-slate">No data yet</td></tr> : null}
        </Table>
        <Table head={["Most-applied jobs", "Apply clicks"]}>
          {topJobs.map((j) => <tr key={j.id}><td className="px-4 py-2">{j.title}</td><td className="px-4 py-2 tabular-nums">{j.applies}</td></tr>)}
          {topJobs.length === 0 ? <tr><td colSpan={2} className="px-4 py-3 text-slate">No data yet</td></tr> : null}
        </Table>
        <Table head={["Referring site", "Visitors"]}>
          {referrers.map((r) => <tr key={r.referrer}><td className="px-4 py-2">{r.referrer}</td><td className="px-4 py-2 tabular-nums">{r.visitors}</td></tr>)}
          {referrers.length === 0 ? <tr><td colSpan={2} className="px-4 py-3 text-slate">No data yet</td></tr> : null}
        </Table>
      </div>

      <h2 className="mt-10 text-xl font-semibold text-ink">Campaigns (ads and tagged links)</h2>
      <p className="mt-1 text-sm text-slate">
        Visitors who arrived through a link with utm_ tags or a Microsoft Ads click ID. Divide your ad spend by sign-ups to get the cost per subscriber.
      </p>
      <div className="mt-4">
        <Table head={["Source", "Campaign", "Ad group / content", "Visitors", "Alert sign-ups", "Trial clicks", "Waitlist sign-ups", "Sign-ups per visitor"]}>
          {campaigns.map((c) => (
            <tr key={`${c.source}|${c.campaign}|${c.content}`}>
              <td className="px-4 py-2">{c.source}</td>
              <td className="px-4 py-2">{c.campaign}</td>
              <td className="px-4 py-2">{c.content}</td>
              <td className="px-4 py-2 tabular-nums">{c.visitors}</td>
              <td className="px-4 py-2 tabular-nums">{c.alerts}</td>
              <td className="px-4 py-2 tabular-nums">{c.trialClicks}</td>
              <td className="px-4 py-2 tabular-nums">{c.waitlist}</td>
              <td className="px-4 py-2 tabular-nums">{rate(c.alerts + c.waitlist, c.visitors)}</td>
            </tr>
          ))}
          {campaigns.length === 0 ? <tr><td colSpan={8} className="px-4 py-3 text-slate">No tagged visits yet. See the README section &quot;Microsoft Ads&quot; for the tracking suffix to add.</td></tr> : null}
        </Table>
      </div>

      <h2 className="mt-10 text-xl font-semibold text-ink">Recent imports</h2>
      <div className="mt-4">
        <Table head={["Run", "Started", "Status", "New", "Updated", "Duplicates", "Problems"]}>
          {lastRuns.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2"><Link href={`/admin/imports/${r.id}`} className="text-accent hover:underline">#{r.id}</Link> <span className="text-slate">{r.trigger}</span></td>
              <td className="px-4 py-2">{fmtDateTime(r.started_at)}</td>
              <td className="px-4 py-2"><StatusPill status={r.status} /></td>
              <td className="px-4 py-2 tabular-nums">{r.jobs_created}</td>
              <td className="px-4 py-2 tabular-nums">{r.jobs_updated}</td>
              <td className="px-4 py-2 tabular-nums">{r.duplicates}</td>
              <td className="px-4 py-2 tabular-nums">{r.feeds_failed + r.items_failed}</td>
            </tr>
          ))}
          {lastRuns.length === 0 ? <tr><td colSpan={7} className="px-4 py-3 text-slate">No imports yet</td></tr> : null}
        </Table>
      </div>
    </AdminShell>
  );
}

type CampaignRow = { source: string; campaign: string; content: string; visitors: number; alerts: number; waitlist: number; trialClicks: number };

/** Visitors and conversions per campaign (first-touch, from utm_* / msclkid). */
async function campaignStats(days: number): Promise<CampaignRow[]> {
  const keyExpr = (col: string) => sql`
    coalesce(nullif(${sql.unsafe(col)}->'campaign'->>'utm_source', ''), case when ${sql.unsafe(col)}->'campaign'->>'msclkid' is not null then 'bing (auto-tagged)' end, 'unknown') as source,
    coalesce(nullif(${sql.unsafe(col)}->'campaign'->>'utm_campaign', ''), '—') as campaign,
    coalesce(nullif(${sql.unsafe(col)}->'campaign'->>'utm_content', ''), '—') as content`;
  const [visits, signups] = await Promise.all([
    sql<{ source: string; campaign: string; content: string; visitors: number; trial_clicks: number }[]>`
      with landings as (
        select distinct on (visitor) visitor, created_at, ${keyExpr("props")}
        from events
        where type = 'pageview' and props ? 'campaign' and visitor is not null and created_at >= now() - make_interval(days => ${days})
        order by visitor, created_at
      )
      select l.source, l.campaign, l.content, count(*)::int as visitors,
             count(*) filter (where exists (
               select 1 from events e where e.type = 'premium_cta_click' and e.visitor = l.visitor and e.created_at >= l.created_at
             ))::int as trial_clicks
      from landings l group by 1, 2, 3`,
    sql<{ source: string; campaign: string; content: string; alerts: number; waitlist: number }[]>`
      select ${keyExpr("props")},
             count(*) filter (where type = 'alert_signup')::int as alerts,
             count(*) filter (where type = 'waitlist_signup')::int as waitlist
      from events
      where type in ('alert_signup', 'waitlist_signup') and props ? 'campaign' and created_at >= now() - make_interval(days => ${days})
      group by 1, 2, 3`,
  ]);
  const map = new Map<string, CampaignRow>();
  const key = (r: { source: string; campaign: string; content: string }) => `${r.source}|${r.campaign}|${r.content}`;
  for (const v of visits) map.set(key(v), { source: v.source, campaign: v.campaign, content: v.content, visitors: v.visitors, trialClicks: v.trial_clicks, alerts: 0, waitlist: 0 });
  for (const s of signups) {
    const row = map.get(key(s)) ?? { source: s.source, campaign: s.campaign, content: s.content, visitors: 0, trialClicks: 0, alerts: 0, waitlist: 0 };
    row.alerts += s.alerts;
    row.waitlist += s.waitlist;
    map.set(key(s), row);
  }
  return [...map.values()].sort((a, b) => b.visitors - a.visitors || b.alerts - a.alerts).slice(0, 30);
}
