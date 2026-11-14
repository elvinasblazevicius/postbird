import siteConfig from "@site-config";
import Link from "next/link";
import { categoryName } from "@/lib/site";
import { sql } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { BILLING_LIVE, PADDLE_ENV } from "@/lib/billing/live";
import { planPriceNumber } from "@/lib/early-access-copy";
import { checkMarkerKey } from "@/lib/billing/trial-markers";
import { pendingCancels, type PendingCancel } from "@/lib/billing/subscriptions";
import { openOpsEvents } from "@/lib/ops-events";
import { DAILY_JOB_STALE_HOURS, dailyJobFresh, readDailyJob, type DailyJobStatus } from "@/lib/heartbeat";
import { resolveBillingFlagAction, resolveOpsEventAction, sendTestEmailAction, syncNowAction } from "./actions";
import { BillingSelfCheck } from "./billing-check";
import { MetaCheck } from "./meta-check";
import { requireAdmin } from "./guard";
import { AdminShell, Card, fmtDateTime, olderThanHours, Stat, StatusPill, Table } from "./ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ days?: string; email?: string }> };

export default async function AdminHome({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const emailResult = typeof sp.email === "string" ? sp.email.slice(0, 200) : null;
  const daysRaw = Number(sp.days);
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

  // Two batches of at most 6 queries: the connection pool has 6 connections (see src/lib/db.ts).
  const [[jobs], [subs], lastRuns, [feeds], [ev], daily] = await Promise.all([
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
    sql<{ visitors: number; pageviews: number; job_views: number; searches: number; apply: number; cta: number; book: number; alert_signups: number; waitlist_signups: number; confirmed: number }[]>`
      select count(distinct visitor) filter (where type = 'pageview')::int as visitors,
             count(*) filter (where type = 'pageview')::int as pageviews,
             count(*) filter (where type = 'job_view')::int as job_views,
             count(*) filter (where type = 'search')::int as searches,
             count(*) filter (where type = 'apply_click')::int as apply,
             count(*) filter (where type = 'premium_cta_click')::int as cta,
             count(*) filter (where type = 'book_click')::int as book,
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
  ]);
  const [topCats, topOrgs, topSearches, topJobs, referrers] = await Promise.all([
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

  // campaignStats runs two queries itself, so it goes first (at most 6 queries at once).
  const campaigns = await campaignStats(days);
  const [[ct], [adConfirmed], planChoices, [bill], [adTrials]] = await Promise.all([
    // Concept test: each paid-ad visitor (Microsoft click id, or utm_medium=cpc) counted once,
    // "converted" if that same visitor later joined early access the same day (the visitor code changes daily).
    sql<{ visitors: number; converted: number }[]>`
      with landings as (
        select distinct on (visitor) visitor, created_at from events
        where type = 'pageview' and visitor is not null
          and (props->'campaign' ? 'msclkid' or lower(props->'campaign'->>'utm_medium') in ('cpc', 'ppc', 'paid'))
        order by visitor, created_at
      )
      select count(*)::int as visitors,
             count(*) filter (where exists (
               select 1 from events e where e.type = 'waitlist_signup' and e.visitor = l.visitor and e.created_at >= l.created_at
             ))::int as converted
      from landings l`,
    sql<{ n: number }[]>`
      select count(*)::int as n from subscribers
      where status = 'confirmed' and premium_waitlist
        and (attribution ? 'msclkid' or lower(attribution->>'utm_medium') in ('cpc', 'ppc', 'paid'))`,
    sql<{ plan: string; n: number }[]>`
      select props->>'plan' as plan, count(*)::int as n from events where type = 'plan_choice' group by 1`,
    // Paid alerts (Paddle). Before migration 004 these columns don't exist yet, so fall back to zeros.
    sql<{ trialing: number; active: number; past_due: number; canceled: number; active_month: number; active_quarter: number; canceled_30: number }[]>`
      select count(*) filter (where billing_status = 'trialing')::int as trialing,
             count(*) filter (where billing_status = 'active')::int as active,
             count(*) filter (where billing_status in ('past_due', 'paused'))::int as past_due,
             count(*) filter (where billing_status = 'canceled')::int as canceled,
             count(*) filter (where billing_status = 'active' and plan_interval = 'month')::int as active_month,
             count(*) filter (where billing_status = 'active' and plan_interval = 'quarter')::int as active_quarter,
             count(*) filter (where billing_status = 'canceled' and canceled_at >= now() - interval '30 days')::int as canceled_30
      from subscribers`.catch(() => [{ trialing: 0, active: 0, past_due: 0, canceled: 0, active_month: 0, active_quarter: 0, canceled_30: 0 }]),
    // Concept test once billing is live: trials started by visitors who came from paid ads
    // (the subscriber's first-touch campaign is stored on the trial_started event).
    sql<{ n: number }[]>`
      select count(*)::int as n from events
      where type = 'trial_started'
        and (props->'campaign' ? 'msclkid' or lower(props->'campaign'->>'utm_medium') in ('cpc', 'ppc', 'paid'))`,
  ]);
  // Subscriptions the webhook held back or couldn't fully check (see db/migrations/010_billing_integrity.sql).
  // A cancel the daily job still retries shows "Cancel still pending" instead of "Mark dealt with",
  // and stays listed even if it was marked dealt with before.
  const pending = await pendingCancels({ limit: 50 }).catch((): PendingCancel[] => []);
  const pendingKeys = new Set(pending.map((p) => `${p.subscription_id}|${p.kind}`));
  const flags = await sql<{ subscription_id: string; kind: string; customer_id: string | null; detail: string | null; updated_at: Date; email: string | null }[]>`
    select f.subscription_id, f.kind, f.customer_id, f.detail, f.updated_at, s.email
    from billing_flags f left join subscribers s on s.id = f.subscriber_id
    where f.resolved_at is null or f.subscription_id || '|' || f.kind = any(${[...pendingKeys]}::text[])
    order by f.updated_at desc limit 20`.catch(() => []);
  // Unexpected errors from the webhook and the scheduled jobs, and whether the scheduled jobs
  // use the same trial-marker secret as this site (see src/lib/billing/trial-markers.ts).
  // The daily job's heartbeat (src/lib/heartbeat.ts): stored at the end of each successful run.
  const [opsEvents, markerKey, dailyJob] = await Promise.all([
    openOpsEvents(),
    checkMarkerKey().catch(() => ({ status: "unknown" as const })),
    readDailyJob().catch((): DailyJobStatus => ({ at: null, billing: null })),
  ]);
  // Monthly recurring revenue estimate: paying subscribers only (not trials), 3-month plans counted at a third. Before Paddle's fees and taxes.
  const mrr = bill.active_month * planPriceNumber("month") + (bill.active_quarter * planPriceNumber("quarter")) / 3;
  const money = (x: number) => `$${x.toFixed(2)}`;
  const planCount = (k: string) => planChoices.find((p) => p.plan === k)?.n ?? 0;
  const test = siteConfig.conceptTest;
  const adVisitors = ct.visitors;
  // While billing is off, a conversion is joining early access; once it is live, starting a free trial.
  const adSignups = BILLING_LIVE ? adTrials.n : ct.converted;
  const converted = BILLING_LIVE ? "started a free trial" : "joined early access";
  const adRate = adVisitors ? adSignups / adVisitors : 0;
  const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const verdict =
    adVisitors < test.minVisitors
      ? { tone: "bg-mist text-ink", title: "Collecting data", text: `${adVisitors} of ${test.minVisitors} ad visitors so far. Current rate ${pct(adRate)}; no verdict yet.` }
      : adRate >= test.successRate
        ? { tone: "bg-remote-bg text-remote", title: "Passed", text: `${pct(adRate)} of ${adVisitors} ad visitors ${converted} (target ${pct(test.successRate)}).${BILLING_LIVE ? "" : " Worth building real billing."}` }
        : adRate < test.failRate
          ? { tone: "bg-[#fde8e8] text-[#9b1c1c]", title: "Failed", text: `${pct(adRate)} of ${adVisitors} ad visitors (below ${pct(test.failRate)}). People don't want to pay for alerts at this price or with this message.` }
          : { tone: "bg-signal-bg text-signal", title: "Unclear", text: `${pct(adRate)} of ${adVisitors} ad visitors, between ${pct(test.failRate)} and ${pct(test.successRate)}. Try a different ad message or price before deciding.` };
  const lastOk = lastRuns.find((r) => r.status === "success" || r.status === "partial");
  const warnings: React.ReactNode[] = [];
  if (feeds.active === 0) warnings.push(<>No active feeds. <Link href="/admin/feeds" className="underline">Add your Inoreader feed</Link>.</>);
  if (feeds.erroring) warnings.push(<>{feeds.erroring} feed(s) failed at the last sync. <Link href="/admin/feeds" className="underline">Check feeds</Link>.</>);
  if (!lastOk) warnings.push(<>No successful import yet. Use &quot;Sync now&quot; to run the first one.</>);
  else if (olderThanHours(lastOk.started_at, 8)) warnings.push(<>The last successful import was over 8 hours ago. Check that the scheduled sync (GitHub Actions) is running.</>);
  if (!dailyJobFresh(dailyJob.at)) {
    warnings.push(dailyJob.at
      ? <>The daily job (emails and billing safety checks) last finished successfully {fmtDateTime(dailyJob.at)}, over {DAILY_JOB_STALE_HOURS} hours ago. Check the &quot;Scheduled jobs&quot; workflow in GitHub Actions: unconfirmed trials aren&apos;t canceled while it is stopped.</>
      : <>The daily job (emails and billing safety checks) hasn&apos;t recorded a successful run yet. Check the &quot;Scheduled jobs&quot; workflow in GitHub Actions.</>);
  }
  if (!isEmailConfigured()) warnings.push(<>Email isn&apos;t set up (RESEND_API_KEY missing). Sign-ups are saved but no confirmation or alert emails are sent.</>);
  if (!process.env.CRON_SECRET) warnings.push(<>CRON_SECRET is missing, so the /api/cron addresses are switched off.</>);
  if (markerKey.status === "missing") {
    warnings.push(<>Neither ANALYTICS_SALT nor CRON_SECRET is set on this site, so the one-free-trial check can&apos;t read trial markers. Set them, using exactly the same values on Netlify and in GitHub.</>);
  } else if (markerKey.status === "mismatch") {
    warnings.push(<>The scheduled jobs (GitHub Actions) use a different ANALYTICS_SALT or CRON_SECRET from this site (last seen {fmtDateTime(markerKey.storedAt)}). Trial markers they write won&apos;t match here, so a deleted address could start a second free trial. Use exactly the same values on Netlify and in GitHub.</>);
  }
  if (jobs.demo) warnings.push(<>{jobs.demo} demo listings are in the database. Remove them with <code>npm run demo:clear</code> before launch.</>);

  const maxV = Math.max(1, ...daily.map((d) => d.visitors));
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

  return (
    <AdminShell
      title="Overview"
      active="/admin"
      actions={
        <div className="flex gap-2">
          <form action={sendTestEmailAction}>
            <button className="rounded-lg border border-rule px-4 py-2 text-sm font-semibold text-ink hover:bg-mist">Send test email</button>
          </form>
          <form action={syncNowAction}>
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent">Sync now</button>
          </form>
        </div>
      }
    >
      {emailResult ? (
        <Card className={`mb-6 ${emailResult.startsWith("sent") ? "bg-remote-bg" : "border-[#f0d9b5] bg-signal-bg"}`}>
          <p className="text-sm text-ink">Test email {emailResult}</p>
        </Card>
      ) : null}
      {warnings.length ? (
        <Card className="mb-6 border-[#f0d9b5] bg-signal-bg">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Card>
      ) : null}

      {opsEvents.length ? (
        <div className="mb-6">
          <h3 className="mb-2 text-base font-semibold text-ink">Errors to look at ({opsEvents.length})</h3>
          <Table head={["Last seen", "Where", "What happened", "Times", ""]}>
            {opsEvents.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(o.last_at)}</td>
                <td className="px-4 py-2">{OPS_LABELS[o.source] ?? o.source}</td>
                <td className="px-4 py-2">{o.message}</td>
                <td className="px-4 py-2">{o.count}{o.count > 1 ? <span className="text-slate">, since {fmtDateTime(o.first_at)}</span> : null}</td>
                <td className="px-4 py-2">
                  <form action={resolveOpsEventAction}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className="text-accent hover:underline">Mark dealt with</button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active vacancies" value={jobs.active} hint={`${jobs.new7} new this week; ${jobs.closed} closed; ${jobs.removed} removed`} />
        <Stat label="Alert subscribers" value={subs.alerts} hint={`${subs.pending} awaiting confirmation; ${subs.unsub} unsubscribed`} />
        <Stat label="Premium waitlist" value={subs.waitlist} hint={`${subs.waitlist_pending} more awaiting confirmation`} />
        <Stat label="Feeds" value={`${feeds.active}/${feeds.total}`} hint={lastOk ? `Last import ${fmtDateTime(lastOk.started_at)}` : "Never imported"} />
      </div>

      <h2 className="mt-10 text-xl font-semibold text-ink">Paid alerts {BILLING_LIVE ? `(Paddle ${PADDLE_ENV})` : "(billing not switched on)"}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="In free trial" value={bill.trialing} hint="card on file, not charged yet" />
        <Stat label="Paying" value={bill.active} hint={`${bill.active_month} monthly, ${bill.active_quarter} on 3 months${bill.past_due ? `; ${bill.past_due} payment overdue or paused` : ""}`} />
        <Stat label="Canceled" value={bill.canceled} hint={`${bill.canceled_30} in the last 30 days`} />
        <Stat label="MRR estimate" value={money(mrr)} hint="paying only; 3-month plans ÷ 3; before Paddle fees and tax" />
      </div>
      {BILLING_LIVE ? (
        <Card className="mt-4">
          <div className="mb-2 text-sm font-medium text-ink">Billing self-check</div>
          <BillingSelfCheck />
          <p className="mt-3 text-sm text-slate">{dailyJobSummary(dailyJob)}</p>
        </Card>
      ) : null}
      <Card className="mt-4">
        <div className="mb-2 text-sm font-medium text-ink">Meta (Facebook and Instagram ads) check</div>
        <MetaCheck />
      </Card>
      {flags.length ? (
        <div className="mt-4">
          <h3 className="mb-2 text-base font-semibold text-ink">Billing flags ({flags.length})</h3>
          <Table head={["When", "What", "Subscriber", "Paddle subscription", "Details", ""]}>
            {flags.map((f) => (
              <tr key={`${f.subscription_id}|${f.kind}`}>
                <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(f.updated_at)}</td>
                <td className="px-4 py-2">{FLAG_LABELS[f.kind] ?? f.kind}</td>
                <td className="px-4 py-2">{f.email ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{f.subscription_id}{f.customer_id ? <><br />{f.customer_id}</> : null}</td>
                <td className="px-4 py-2">{f.detail}</td>
                <td className="px-4 py-2">
                  {pendingKeys.has(`${f.subscription_id}|${f.kind}`) ? (
                    <span className="whitespace-nowrap text-slate">Cancel still pending</span>
                  ) : (
                    <form action={resolveBillingFlagAction}>
                      <input type="hidden" name="subscription_id" value={f.subscription_id} />
                      <input type="hidden" name="kind" value={f.kind} />
                      <button className="text-accent hover:underline">Mark dealt with</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}

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
          Rule set before launch: pass at {pct(test.successRate)} or more, fail below {pct(test.failRate)}, from at least {test.minVisitors} visitors arriving from paid ads. Change it in site.config.ts.
          {BILLING_LIVE ? " Billing is live, so a conversion is a free trial started by an ad visitor (card required)." : " A conversion is joining early access."}
        </div>
        <div className="mt-2 text-sm">
          Ad sign-ups that confirmed their email: {adConfirmed.n}. &quot;Which plan would you choose?&quot; (all sign-ups): {planCount("monthly")} monthly,{" "}
          {planCount("three_months")} 3 months, {planCount("would_not_pay")} wouldn&apos;t pay.
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visitors" value={ev.visitors} hint={`${ev.pageviews} page views`} />
        <Stat label="Job views" value={ev.job_views} hint={`${ev.searches} filtered searches`} />
        <Stat label="Apply clicks" value={ev.apply} hint={`${rate(ev.apply, ev.job_views)} of job views`} />
        <Stat label="Email-alert interest" value={ev.cta} hint={`button clicks; ${ev.waitlist_signups} left an email (${rate(ev.waitlist_signups, ev.cta)})`} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-4">
          <Stat label="Alert sign-ups" value={ev.alert_signups} hint={`${ev.confirmed} confirmations; ${rate(ev.alert_signups, ev.visitors)} of visitors signed up`} />
          <Stat label="EPSO book clicks" value={ev.book} hint="Clicks on the book box (EU institution pages). Sales show in your KDP reports." />
        </div>
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

const OPS_LABELS: Record<string, string> = {
  webhook: "Paddle webhook",
  sync: "Scheduled import",
  emails: "Scheduled emails",
};

const FLAG_LABELS: Record<string, string> = {
  trial_blocked: "Second free trial blocked",
  customer_mismatch: "Paddle customer's email doesn't match",
  customer_unverified: "Paddle customer not checked yet",
  duplicate_subscription: "Second subscription for one address",
  trial_unconfirmed: "Trial canceled: address never confirmed",
};

/** One line about the last successful daily run's billing safety checks (stored with its heartbeat). */
function dailyJobSummary(d: DailyJobStatus): string {
  if (!d.at) return "The daily job hasn't recorded a successful run yet.";
  const when = `Last successful daily job: ${fmtDateTime(d.at)}.`;
  const b = d.billing;
  if (!b) return when;
  if ("skipped" in b) return `${when} Billing safety checks skipped: ${b.skipped}`;
  return `${when} Billing safety: ${b.unconfirmed.canceled} unconfirmed trial(s) canceled (${b.unconfirmed.failed} failed), ${b.cancelRetries.canceled} earlier cancel(s) retried (${b.cancelRetries.failed} failed), ${b.customers.verified} customer(s) checked, ${b.customers.mismatch} mismatch(es), ${b.customers.unverified} still unchecked.`;
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
