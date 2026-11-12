/**
 * Scheduled emails:
 *  - runDigest(): the free weekly email (when siteConfig.freeWeeklyEmail is
 *    on), sent on Mondays (or by Wednesday when Monday's run was missed): for
 *    each free subscriber, the new vacancies of the
 *    past week that match their one saved search (or the week's newest when
 *    they chose none). Nothing is sent to someone with no new matches.
 *    Subscribers with a plan never get it; they get runAlerts() instead.
 *  - runAlerts(): paid email alerts, one email per subscriber with the new
 *    matches for each of their saved searches, daily or weekly, and the
 *    matching vacancies that close in the next 3 days ("Closing soon", each
 *    listed once per subscriber). The free weekly email never has that section.
 * Both are safe to run more often than needed (they skip what was already sent).
 *  - runDailyJob(): the daily job (billing safety checks, plan emails, then the two above), each
 *    task on its own so one failure doesn't stop the rest.
 */
import { createHash } from "node:crypto";
import siteConfig from "@site-config";
import { continueUrl, weeklyCheckoutLinks } from "@/lib/billing/checkout-links";
import { BILLING_LIVE } from "@/lib/billing/live";
import { runPlanEmails, type PlanEmailsResult } from "@/lib/billing/notices";
import { ALERT_STATUSES, LIVE_STATUSES } from "@/lib/billing/statuses";
import { hadTrialBefore, runBillingSafety, type BillingSafetyResult, type PlanHistory } from "@/lib/billing/subscriptions";
import { trialUsedElsewhereIds } from "@/lib/billing/trial-markers";
import { sql, transaction } from "@/lib/db";
import { batchKey, isEmailConfigured, sendBatch, type OutgoingEmail } from "@/lib/email";
import { recordDailyJob } from "@/lib/heartbeat";
import { recordOpsEvent } from "@/lib/ops-events";
import { alertEmail, capGroups, CLOSING_SOON_DAYS, CLOSING_SOON_MAX, MAX_JOBS_PER_EMAIL, weeklyEmail, type AlertGroup } from "@/lib/email-templates";
import { acquireLock, releaseLock } from "@/lib/feeds/sync";
import { closingSoonForAlert, filtersFromQuery, jobsUrl, searchJobs, type JobListItem } from "@/lib/jobs";
import { describeSearch } from "@/lib/saved-searches";
import { absoluteUrl } from "@/lib/site";

export function isoWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC of the (ISO, Monday-first) week that contains d. */
export function weekStart(d: Date): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() || 7) - 1));
  return t;
}

/** The free weekly email goes out on this day (UTC; 1 = Monday). The scheduled job runs every day at 06:23 UTC. */
export const WEEKLY_SEND_DAY = 1;
/**
 * The last day (UTC; 3 = Wednesday) a week's email may still start when no run
 * started it on Monday (the job didn't run, or the host was down), so one
 * missed run doesn't lose the week. Later in the week it waits for next Monday.
 */
export const WEEKLY_LAST_START_DAY = 3;
/** Matches listed in the free weekly email (the rest are behind its "See all" button). */
const WEEKLY_JOBS_PER_SEARCH = 10;
/** The weekly email covers vacancies first seen in this many days before the week's first run. */
const WEEK_HOURS = 7 * 24;

export type DigestResult = {
  status: "sent" | "skipped" | "failed";
  periodKey: string;
  recipients: number;
  sent: number;
  failed: number;
  /** Free subscribers checked whose search had no new match this week (sent nothing). */
  empty: number;
  /** New vacancies (all of them, before matching) in the week's window. */
  jobs: number;
  message: string | null;
};

type WeeklyRow = {
  id: number;
  email: string;
  last_digest_at: Date | null;
  search_id: number | null;
  search: string;
  label: string | null;
  last_sent_at: Date | null;
};

type WeeklyOut = { row: WeeklyRow; group: AlertGroup; trialUrl: string };

/**
 * The free weekly email. Runs from the daily scheduled job and starts on
 * Mondays (UTC), or on Tuesday or Wednesday when no run started that week's
 * email yet (a missed Monday): the first run of an ISO week records the week
 * in `digests` and its start time is the week's cut-off, so a retry later in
 * the week (when that run failed or was cut off) covers exactly the same
 * window and sends the same email. Each subscriber gets at most one weekly
 * email per ISO week (last_digest_at). force (the admin's "send now"): skips
 * the day rule and the "already done" check, never the one-per-week rule.
 * `at` replaces the database clock for the day and week rules (tests only).
 */
export async function runDigest(opts: { force?: boolean; at?: Date } = {}): Promise<DigestResult> {
  const [{ now }] = await sql<{ now: Date }[]>`select now() as now`;
  const at = opts.at ?? new Date(now);
  const periodKey = isoWeekKey(at);
  const base: DigestResult = { status: "skipped", periodKey, recipients: 0, sent: 0, failed: 0, empty: 0, jobs: 0, message: null };
  if (!siteConfig.freeWeeklyEmail) return { ...base, message: "The free weekly email is switched off (freeWeeklyEmail in site.config.ts)." };
  if (!isEmailConfigured()) return { ...base, message: "Email sending is not configured (RESEND_API_KEY missing)." };

  const holder = `digest-${Date.now()}`;
  if (!(await acquireLock("digest", holder, 15))) return { ...base, message: "A digest is already being sent." };
  try {
    const existing = (await sql<{ status: string }[]>`select status from digests where period_key = ${periodKey}`)[0];
    if (existing?.status === "done" && !opts.force) return { ...base, message: `The weekly email for ${periodKey} was already sent.` };
    // A week that hasn't started sending yet starts Monday to Wednesday only; one that started (and failed) is retried any day.
    const day = at.getUTCDay() || 7;
    if (!existing && !opts.force && (day < WEEKLY_SEND_DAY || day > WEEKLY_LAST_START_DAY)) {
      return { ...base, message: "The weekly email goes out on Mondays (or by Wednesday if Monday's run was missed)." };
    }

    // started_at is kept from the week's first run: it is the cut-off of the week's window.
    const [{ cutoff }] = await sql<{ cutoff: Date }[]>`
      insert into digests (period_key, status) values (${periodKey}, 'running')
      on conflict (period_key) do update set status = 'running'
      returning started_at as cutoff`;
    const until = new Date(cutoff);
    const from = new Date(until.getTime() - WEEK_HOURS * 3_600_000);
    const [{ total }] = await sql<{ total: number }[]>`
      select count(*)::int as total from jobs
      where status = 'active' and not is_demo and first_seen_at > ${from} and first_seen_at <= ${until}`;

    // Free subscribers not yet emailed this week, each with their one saved search ('' = every new vacancy).
    // Someone whose plan ended may still have several searches: the oldest one is used.
    const recipients = await sql<WeeklyRow[]>`
      select s.id::int as id, s.email, s.last_digest_at,
             ss.id::int as search_id, coalesce(ss.search, '') as search, ss.label, ss.last_sent_at
      from subscribers s
      left join lateral (
        select id, search, label, last_sent_at from saved_searches where subscriber_id = s.id order by created_at, id limit 1
      ) ss on true
      where s.status = 'confirmed' and s.weekly_email
        -- With a plan (LIVE_STATUSES): paid alerts (or none while on hold), never the free weekly email.
        and s.billing_status <> all(${LIVE_STATUSES})
        and (s.last_digest_at is null or s.last_digest_at < ${weekStart(at)})
      order by s.id`;

    let sent = 0, failed = 0, empty = 0;
    const errors: string[] = [];
    const outbox: WeeklyOut[] = [];
    // Many free subscribers share a search (often ""): look each window up once.
    const cache = new Map<string, Promise<{ items: JobListItem[]; total: number }>>();
    const labels = new Map<string, Promise<string | null>>();

    const flush = async () => {
      if (!outbox.length) return;
      const pending = outbox.splice(0, outbox.length);
      // Current links and status at send time: anyone who unsubscribed or started a plan meanwhile is skipped.
      const current = await sql<(PlanHistory & { id: number; email: string; manage_token: string; unsubscribe_token: string })[]>`
        select id::int as id, email, manage_token, unsubscribe_token, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unconfirmed_trial_sub from subscribers
        where id = any(${pending.map((o) => o.row.id)}) and status = 'confirmed' and weekly_email and billing_status <> all(${LIVE_STATUSES})`;
      const byId = new Map(current.map((c) => [c.id, c]));
      const chunk = pending.filter((o) => byId.has(o.row.id));
      if (!chunk.length) return;
      // One trial per person: addresses deleted after a plan and signed up again keep their trial
      // marker, and another form of the same address (name+x@, Gmail dots) may have had a plan.
      const elsewhere = await trialUsedElsewhereIds(current.map((c) => ({ id: c.id, email: c.email })));
      // The address is proven (confirmed, and this email reaches it), so the upgrade link goes straight
      // to checkout instead of the public form, which would only email it a link first.
      const checkout = BILLING_LIVE ? await weeklyCheckoutLinks(periodKey, chunk.map((o) => ({ subscriberId: o.row.id, search: o.row.search || null }))) : new Map<number, string>();
      const msgs: OutgoingEmail[] = chunk.map((o) => {
        const c = byId.get(o.row.id)!;
        const oneClick = absoluteUrl(`/api/unsubscribe?token=${c.unsubscribe_token}`);
        return {
          to: c.email,
          ...weeklyEmail({
            group: o.group,
            search: o.row.search,
            trialUrl: checkout.has(c.id) ? continueUrl(checkout.get(c.id)!) : o.trialUrl,
            // One free trial per person: someone who had a plan isn't offered another trial.
            hadTrial: hadTrialBefore(c, elsewhere.has(c.id)),
            accountUrl: absoluteUrl(`/account?t=${c.manage_token}`),
            unsubscribeUrl: absoluteUrl(`/alerts/unsubscribe?token=${c.unsubscribe_token}`),
          }),
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          idempotencyKey: `digest:${periodKey}:${o.row.id}`,
        };
      });
      // One key per batch, built from each message's key digest:{week}:{subscriberId}: a retry of
      // the same recipients that already went out is not sent twice, and a different set of
      // recipients (someone unsubscribed or joined in between) never reuses a key. The week's
      // window is fixed (cut-off above), so a retry sends the same message under the same key.
      // If Resend rejects the batch (422), its messages go one by one under their own keys.
      const res = await sendBatch(msgs, () => batchKey(`digest:${periodKey}`, chunk.map((o) => `digest:${periodKey}:${o.row.id}`)));
      sent += res.sent;
      failed += res.failed;
      errors.push(...res.errors);
      // Only the messages Resend accepted count as sent; the rest are retried by the next run this week.
      const done = chunk.filter((_, j) => res.delivered[j]);
      if (done.length) {
        await sql`update subscribers set last_digest_at = ${until} where id = any(${done.map((o) => o.row.id)})`;
        const searchIds = done.map((o) => o.row.search_id).filter((x): x is number => x !== null);
        if (searchIds.length) {
          await sql`update saved_searches set last_sent_at = ${until} where id = any(${searchIds}) and (last_sent_at is null or last_sent_at < ${until})`;
        }
      }
    };

    for (const r of recipients) {
      // Only what wasn't in an earlier email (weekly, or paid alerts before a plan ended), and at most a week back.
      const since = new Date(Math.max(
        from.getTime(),
        r.last_digest_at ? new Date(r.last_digest_at).getTime() : 0,
        r.last_sent_at ? new Date(r.last_sent_at).getTime() : 0,
      ));
      let filters: ReturnType<typeof filtersFromQuery>, res: { items: JobListItem[]; total: number }, label: string;
      try {
        filters = filtersFromQuery(r.search);
        const key = `${r.search}|${since.getTime()}`;
        if (!cache.has(key)) {
          const p = searchJobs({ ...filters, page: undefined, posted: undefined, sort: "newest", firstSeenAfter: since, firstSeenUntil: until, excludeDemo: true }, WEEKLY_JOBS_PER_SEARCH);
          p.catch(() => {}); // awaited below (and by later subscribers with the same search)
          cache.set(key, p);
        }
        res = await cache.get(key)!;
        if (res.total === 0) { empty++; continue; }
        if (!labels.has(r.search)) {
          const l = r.search ? describeSearch(r.search) : Promise.resolve(null);
          l.catch(() => {});
          labels.set(r.search, l);
        }
        label = r.search ? (r.label || (await labels.get(r.search)!) || "Your search") : "All new vacancies";
      } catch (e) {
        // This subscriber's search failed: not sent and still due (the week stays open for the
        // next run); everyone else's email goes out as usual.
        failed++;
        errors.push(`Search lookup failed: ${(e as Error).message}`);
        continue;
      }
      outbox.push({
        row: r,
        group: {
          label,
          // "See all" opens the search on the site, limited to the past week (close to, not exactly, the email's window).
          url: absoluteUrl(jobsUrl({ ...filters, page: undefined, sort: undefined, posted: "7" })) + "&utm_source=digest&utm_medium=email",
          jobs: res.items,
          total: res.total,
        },
        trialUrl: absoluteUrl(`/pricing/trial?${r.search ? `search=${encodeURIComponent(r.search)}&` : ""}utm_source=digest&utm_medium=email`),
      });
      if (outbox.length >= 100) await flush();
    }
    await flush();

    const message = errors.length ? errors.slice(0, 3).join("; ") : null;
    // A week with failures stays open, so the next daily run retries the subscribers not yet emailed.
    await sql`
      update digests set status = ${failed ? "failed" : "done"}, recipients = ${recipients.length - empty}, sent = ${sent},
        failed = ${failed}, jobs_included = ${total}, message = ${message}, finished_at = now()
      where period_key = ${periodKey}`;
    return { status: failed && !sent ? "failed" : "sent", periodKey, recipients: recipients.length - empty, sent, failed, empty, jobs: total, message };
  } finally {
    await releaseLock("digest", holder);
  }
}

/**
 * Runs fn over items, at most `limit` at a time; resolves once all are done (rejects on the first
 * failure, so callers that must go on past a failed item catch inside fn).
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Paid email alerts ────────────────────────────────────────

/**
 * Matches fetched per saved search for one paid alert (the rest are behind a "See all" link).
 * The email lists at most MAX_JOBS_PER_EMAIL (50) in all, shared evenly between the searches (capGroups).
 */
const JOBS_PER_SEARCH = 20;
/** A daily subscriber gets at most one email in this many hours; a weekly one in 6.5 days. Runs drift by minutes, so not 24h / 7d. */
const MIN_HOURS_BETWEEN = { daily: 20, weekly: 156 } as const;
/** At most this many alert searches run at once (each takes up to two of the pool's connections, see src/lib/db.ts). */
const ALERT_SEARCH_CONCURRENCY = 4;
/** First email for a search: vacancies first seen in the last day or week. */
const FIRST_WINDOW_HOURS = { daily: 24, weekly: 7 * 24 } as const;
/** Never look back further than this (e.g. after a paused subscription resumes). */
const MAX_WINDOW_HOURS = { daily: 7 * 24, weekly: 14 * 24 } as const;

export type AlertsResult = { status: "sent" | "skipped" | "failed"; due: number; sent: number; failed: number; empty: number; message: string | null };

type DueRow = { id: number; email: string; frequency: "daily" | "weekly"; plan_started_at: Date | null };

/**
 * The idempotency key of one paid alert: the subscriber and where each of its
 * searches' windows starts (its last_sent_at, or "new" for a search never
 * emailed). A run that stopped after Resend accepted the email but before
 * last_sent_at was written builds the same key again, so a run soon after
 * can't send the same email twice; once last_sent_at moves on, the next email
 * gets a new key. Pure, so it is unit-tested.
 */
export function alertKey(subscriberId: number, searches: { id: number; last_sent_at: Date | string | null }[]): string {
  const windows = [...searches]
    .sort((a, b) => a.id - b.id)
    .map((x) => `${x.id}@${x.last_sent_at ? new Date(x.last_sent_at).toISOString() : "new"}`)
    .join(",");
  return `alert:${subscriberId}:${createHash("sha256").update(windows).digest("hex").slice(0, 32)}`;
}
type SearchRow = { id: number; subscriber_id: number; search: string; label: string | null; last_sent_at: Date | null };

/**
 * Sends paid alerts to subscribers in trial or paying (billing_status
 * trialing/active) who are due by their frequency. For each saved search it
 * looks for open vacancies first seen after the search's last_sent_at (or the
 * last 24 hours / 7 days for a new search) and up to the start of this run.
 * Each email also lists, under "Closing in the next 3 days", up to 10 open
 * vacancies that match any of the subscriber's searches (any posting date)
 * and close between today and 3 days ahead (UTC), soonest first, leaving out
 * the ones already among the email's new matches. A vacancy is listed there
 * at most once per subscriber (alert_closing_sent, recorded once Resend
 * accepted the email). Subscribers with neither new matches nor closing-soon
 * vacancies get nothing and stay due. After a
 * successful send every search of that subscriber gets last_sent_at = the
 * run's start time, together with the closing-soon record in one transaction,
 * so nothing is sent twice and nothing falls between runs. Each email's
 * idempotency key comes from its searches' windows (alertKey).
 * The account and unsubscribe links are read just before each batch is sent,
 * so they are always the subscriber's current ones (the account link changes
 * when someone asks for it by email), and anyone who unsubscribed or stopped
 * paying during the run is skipped.
 */
export async function runAlerts(opts: { limit?: number } = {}): Promise<AlertsResult> {
  const base: AlertsResult = { status: "skipped", due: 0, sent: 0, failed: 0, empty: 0, message: null };
  if (!isEmailConfigured()) return { ...base, message: "Email sending is not configured (RESEND_API_KEY missing)." };

  const holder = `alerts-${Date.now()}`;
  if (!(await acquireLock("digest", holder, 15))) return { ...base, message: "Emails are already being sent." };
  try {
    // One clock for the whole run: the database's.
    const [{ now }] = await sql<{ now: Date }[]>`select now() as now`;
    // A plan that went live since the last email is due at once: the free weekly email may have set
    // last_sent_at this morning, and the first paid alert shouldn't wait a day for it.
    const due = await sql<DueRow[]>`
      select s.id::int as id, s.email, s.frequency, s.plan_started_at
      from subscribers s
      where s.status = 'confirmed' and s.billing_status = any(${ALERT_STATUSES})
        and exists (select 1 from saved_searches ss where ss.subscriber_id = s.id)
        and (coalesce((select max(ss.last_sent_at) from saved_searches ss where ss.subscriber_id = s.id), '-infinity'::timestamptz)
               <= ${now}::timestamptz - make_interval(hours => case when s.frequency = 'daily' then ${MIN_HOURS_BETWEEN.daily}::int else ${MIN_HOURS_BETWEEN.weekly}::int end)
             or (s.plan_started_at is not null
                 and not exists (select 1 from saved_searches ss where ss.subscriber_id = s.id and ss.last_sent_at >= s.plan_started_at)))
      order by s.id
      limit ${opts.limit ?? 5000}`;
    if (due.length === 0) return { ...base, status: "sent", message: "No subscribers due." };

    const searches = await sql<SearchRow[]>`
      select id::int as id, subscriber_id::int as subscriber_id, search, label, last_sent_at
      from saved_searches where subscriber_id = any(${due.map((d) => d.id)}) order by created_at, id`;

    let sent = 0, failed = 0, empty = 0;
    const errors: string[] = [];
    const outbox: { sub: DueRow; groups: AlertGroup[]; closing: JobListItem[]; key: string }[] = [];

    const flush = async () => {
      if (!outbox.length) return;
      const pending = outbox.splice(0, outbox.length);
      // Current links and status at send time.
      const current = await sql<(PlanHistory & { id: number; email: string; manage_token: string; unsubscribe_token: string })[]>`
        select id::int as id, email, manage_token, unsubscribe_token, paddle_subscription_id, billing_status, trial_ends_at, canceled_at from subscribers
        where id = any(${pending.map((o) => o.sub.id)}) and status = 'confirmed' and billing_status = any(${ALERT_STATUSES})`;
      const byId = new Map(current.map((c) => [c.id, c]));
      const chunk = pending.filter((o) => byId.has(o.sub.id));
      if (!chunk.length) return;
      const msgs: OutgoingEmail[] = chunk.map((o) => {
        const c = byId.get(o.sub.id)!;
        const unsubscribeUrl = absoluteUrl(`/alerts/unsubscribe?token=${c.unsubscribe_token}`);
        const oneClick = absoluteUrl(`/api/unsubscribe?token=${c.unsubscribe_token}`);
        return {
          to: c.email,
          ...alertEmail({ groups: o.groups, closing: o.closing, frequency: o.sub.frequency, accountUrl: absoluteUrl(`/account?t=${c.manage_token}`), unsubscribeUrl }),
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          idempotencyKey: o.key,
        };
      });
      // Resend takes one idempotency key per batch: built from each message's key (see alertKey),
      // so a retry can't send twice. If Resend rejects the batch (422), its messages go one by
      // one under their own keys.
      const res = await sendBatch(msgs, () => batchKey("alerts", chunk.map((o) => o.key)));
      sent += res.sent;
      failed += res.failed;
      errors.push(...res.errors);
      // Only subscribers whose email Resend accepted move on; the others stay due.
      const done = chunk.filter((_, j) => res.delivered[j]);
      if (done.length) {
        // Both records of what was sent commit together, or neither does (then the next run
        // builds the same keys again, see alertKey).
        const listed = done.flatMap((o) => o.closing.map((j) => [o.sub.id, Number(j.id)] as const));
        await transaction(async (tx) => {
          await tx`update saved_searches set last_sent_at = ${now} where subscriber_id = any(${done.map((o) => o.sub.id)})`;
          // The closing-soon vacancies these emails listed are never listed again for the same subscriber.
          if (listed.length) {
            await tx`
              insert into alert_closing_sent (subscriber_id, job_id)
              select t.s, t.j from unnest(${listed.map((x) => x[0])}::bigint[], ${listed.map((x) => x[1])}::bigint[]) as t(s, j)
              where exists (select 1 from jobs where id = t.j) and exists (select 1 from subscribers where id = t.s)
              on conflict do nothing`;
          }
        });
      }
    };

    // Many subscribers share a search and a window (a new search, or one emailed by the same
    // earlier run): each is looked up once per run, at most ALERT_SEARCH_CONCURRENCY at a time.
    type Lookup = { key: string; search: string; since: Date };
    const cache = new Map<string, Promise<{ items: JobListItem[]; total: number }>>();
    const lookup = (l: Lookup) => {
      if (!cache.has(l.key)) {
        const filters = filtersFromQuery(l.search);
        const p = searchJobs({ ...filters, page: undefined, posted: undefined, sort: "newest", firstSeenAfter: l.since, firstSeenUntil: now, excludeDemo: true }, JOBS_PER_SEARCH);
        p.catch(() => {}); // awaited below; this only keeps an early failure from being reported as unhandled
        cache.set(l.key, p);
      }
      return cache.get(l.key)!;
    };
    const windowsFor = (sub: DueRow) => searches.filter((x) => x.subscriber_id === sub.id).map((s) => {
      const firstHours = FIRST_WINDOW_HOURS[sub.frequency] ?? FIRST_WINDOW_HOURS.weekly;
      const maxHours = MAX_WINDOW_HOURS[sub.frequency] ?? MAX_WINDOW_HOURS.weekly;
      const firstWindow = now.getTime() - firstHours * 3_600_000;
      // A new plan's first alert covers its own time (or one normal window), not a week of
      // backlog from before it started.
      const planFloor = sub.plan_started_at ? Math.min(new Date(sub.plan_started_at).getTime(), firstWindow) : 0;
      const since = new Date(Math.max(
        s.last_sent_at ? new Date(s.last_sent_at).getTime() : firstWindow,
        now.getTime() - maxHours * 3_600_000,
        planFloor,
      ));
      return { s, l: { key: `${s.search}|${since.getTime()}`, search: s.search, since } };
    });

    /** A subscriber whose lookup failed: not sent and still due (the next run tries again); everyone else goes ahead. */
    const lookupFailed = (e: unknown) => {
      failed++;
      errors.push(`Search lookup failed: ${(e as Error)?.message ?? String(e)}`);
    };

    // In slices of 100 subscribers (one email batch each): run the slice's searches, then build its emails.
    for (let i = 0; i < due.length; i += 100) {
      const slice = due.slice(i, i + 100).map((sub) => ({ sub, items: windowsFor(sub) }));
      const todo = new Map<string, Lookup>();
      for (const x of slice) for (const { l } of x.items) if (!cache.has(l.key)) todo.set(l.key, l);
      // A failed search is reported below, for each subscriber who has it.
      await mapLimit([...todo.values()], ALERT_SEARCH_CONCURRENCY, async (l) => { try { await lookup(l); } catch { /* reported below */ } });

      const built: { sub: DueRow; groups: AlertGroup[] }[] = [];
      for (const { sub, items } of slice) {
        try {
          const groups: AlertGroup[] = [];
          for (const { s, l } of items) {
            const res = await lookup(l);
            if (res.total === 0) continue;
            // "See all" opens the search on the site, limited to the last day or week (close to, not exactly, the email's window).
            const posted = sub.frequency === "daily" ? "1" : "7";
            groups.push({
              label: s.label || "All new vacancies",
              url: absoluteUrl(jobsUrl({ ...filtersFromQuery(s.search), page: undefined, sort: undefined, posted })) + "&utm_source=alert&utm_medium=email",
              jobs: res.items,
              total: res.total,
            });
          }
          built.push({ sub, groups });
        } catch (e) {
          // Not sent with only some of its searches: that would move every search's window on.
          lookupFailed(e);
        }
      }
      // Closing soon: one query per subscriber (it depends on what they were already sent), at
      // most ALERT_SEARCH_CONCURRENCY at a time. Listings the email already lists as new matches are left out.
      const closing = await mapLimit(built, ALERT_SEARCH_CONCURRENCY, ({ sub, groups }) => closingSoonForAlert({
        searches: searches.filter((x) => x.subscriber_id === sub.id).map((x) => x.search),
        subscriberId: sub.id,
        days: CLOSING_SOON_DAYS,
        limit: CLOSING_SOON_MAX,
        // Only the new matches the email will list (not every fetched one), so a vacancy that
        // closes soon is never left out of both sections.
        excludeIds: capGroups(groups, MAX_JOBS_PER_EMAIL - CLOSING_SOON_MAX).flatMap((g) => g.jobs.map((j) => j.id)),
      }).catch((e: unknown) => ({ error: e })));
      built.forEach(({ sub, groups }, k) => {
        const c = closing[k];
        if (!Array.isArray(c)) { lookupFailed(c.error); return; }
        if (groups.length === 0 && c.length === 0) { empty++; return; }
        outbox.push({ sub, groups, closing: c, key: alertKey(sub.id, searches.filter((x) => x.subscriber_id === sub.id)) });
      });
      await flush();
    }

    const message = errors.length ? errors.slice(0, 3).join("; ") : null;
    return { status: failed && !sent ? "failed" : "sent", due: due.length, sent, failed, empty, message };
  } finally {
    await releaseLock("digest", holder);
  }
}

// ── The daily job ────────────────────────────────────────────

type Failed = { failed: string };

export type DailyJobResult = {
  billing: BillingSafetyResult | Failed;
  planEmails: PlanEmailsResult | Failed;
  digest: DigestResult | Failed;
  alerts: AlertsResult | Failed;
  /** One line per task that failed (threw, or sent nothing because everything failed); empty for a good run. */
  failed: string[];
};

/**
 * The daily job (scripts/digest.ts in GitHub Actions, or /api/cron/digest): the billing safety
 * checks first (nothing there depends on email), then the plan emails (trial reminders and
 * confirmation emails are time-critical), the free weekly email (skips itself when this week's was
 * already sent) and the paid alerts. Each task runs on its own: one that throws is recorded on
 * Admin → Overview (Errors to look at) and the next one still runs. Only a run where nothing failed
 * stores the heartbeat (src/lib/heartbeat.ts); the callers fail the run when `failed` isn't empty.
 */
export async function runDailyJob(): Promise<DailyJobResult> {
  const failed: string[] = [];
  const task = async <T>(name: string, fn: () => Promise<T>): Promise<T | Failed> => {
    try {
      return await fn();
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      console.error(`${name} failed`, e);
      failed.push(`${name} failed: ${message}`);
      await recordOpsEvent("emails", `${name} failed: ${message}`);
      return { failed: message };
    }
  };

  const billing = await task("Billing safety checks", () => runBillingSafety());
  if ("unconfirmed" in billing) {
    const failedCancels = billing.unconfirmed.failed + billing.cancelRetries.failed;
    if (failedCancels) await recordOpsEvent("emails", `${failedCancels} subscription(s) could not be canceled in Paddle; see Admin → Overview → Billing flags.`);
  }
  const planEmails = await task("Plan emails", () => runPlanEmails());
  const digest = await task("Weekly email", () => runDigest());
  // A run that sent nothing because everything failed is shown on Admin → Overview too.
  if ("status" in digest && digest.status === "failed") {
    failed.push(`Weekly email failed: ${digest.message ?? "no details"}`);
    await recordOpsEvent("emails", `Weekly email failed: ${digest.message ?? "no details"}`);
  }
  const alerts = await task("Alerts", () => runAlerts());
  if ("status" in alerts && alerts.status === "failed") {
    failed.push(`Alerts failed: ${alerts.message ?? "no details"}`);
    await recordOpsEvent("emails", `Alerts failed: ${alerts.message ?? "no details"}`);
  }

  // Only a good run counts as the day's run (Admin → Overview, /api/health).
  if (!failed.length && !("failed" in billing)) {
    await recordDailyJob(billing).catch(async (e: Error) => {
      failed.push(`Heartbeat not stored: ${e.message}`);
      await recordOpsEvent("emails", `Daily job heartbeat not stored: ${e.message}`);
    });
  }
  return { billing, planEmails, digest, alerts, failed };
}
