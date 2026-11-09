/**
 * Scheduled emails:
 *  - runDigest(): the weekly round-up of all new vacancies (free plan, when
 *    siteConfig.freeWeeklyEmail is on). Paying subscribers never get it; they
 *    get runAlerts() instead.
 *  - runAlerts(): paid email alerts, one email per subscriber with the new
 *    matches for each of their saved searches, daily or weekly.
 * Both are safe to run more often than needed (they skip what was already sent).
 */
import siteConfig from "@site-config";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendBatch } from "@/lib/email";
import { alertEmail, digestEmail, type AlertGroup } from "@/lib/email-templates";
import { acquireLock, releaseLock } from "@/lib/feeds/sync";
import { jobsUrl, parseFilters, searchJobs, type JobListItem } from "@/lib/jobs";
import { absoluteUrl } from "@/lib/site";

function isoWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type DigestResult = { status: "sent" | "skipped" | "failed"; periodKey: string; recipients: number; sent: number; failed: number; jobs: number; message: string | null };

export async function runDigest(opts: { force?: boolean } = {}): Promise<DigestResult> {
  const periodKey = isoWeekKey();
  const base: DigestResult = { status: "skipped", periodKey, recipients: 0, sent: 0, failed: 0, jobs: 0, message: null };
  if (!isEmailConfigured()) return { ...base, message: "Email sending is not configured (RESEND_API_KEY missing)." };

  const holder = `digest-${Date.now()}`;
  if (!(await acquireLock("digest", holder, 15))) return { ...base, message: "A digest is already being sent." };
  try {
    const existing = (await sql<{ status: string }[]>`select status from digests where period_key = ${periodKey}`)[0];
    if (existing?.status === "done" && !opts.force) return { ...base, message: `Digest ${periodKey} was already sent.` };

    const jobs = await sql<JobListItem[]>`
      select j.id, j.slug, j.title, o.name as org_name, o.slug as org_slug, o.short_name as org_short, j.country_code, j.city,
             j.location_text, j.is_remote, j.category, j.job_type, j.grade, j.published_at, j.first_seen_at,
             j.deadline::text as deadline, j.status, j.is_demo
      from jobs j left join organizations o on o.id = j.organization_id
      where j.status = 'active' and not j.is_demo and j.first_seen_at >= now() - interval '7 days'
      order by coalesce(j.published_at, j.first_seen_at) desc limit 15`;
    const [{ total }] = await sql<{ total: number }[]>`
      select count(*)::int as total from jobs where status = 'active' and not is_demo and first_seen_at >= now() - interval '7 days'`;
    if (jobs.length === 0) return { ...base, message: "No new vacancies this week; nothing sent." };

    await sql`
      insert into digests (period_key, status, jobs_included) values (${periodKey}, 'running', ${total})
      on conflict (period_key) do update set status = 'running', started_at = now()`;

    const recipients = await sql<{ id: number; email: string; unsubscribe_token: string }[]>`
      select id, email, unsubscribe_token from subscribers
      where status = 'confirmed' and wants_alerts
        and ${siteConfig.freeWeeklyEmail}
        and billing_status not in ('trialing', 'active')  -- paying subscribers get their own alerts (runAlerts)
        and (last_digest_at is null or last_digest_at < now() - interval '6 days')
      order by id`;

    let sent = 0, failed = 0;
    const errors: string[] = [];
    for (let i = 0; i < recipients.length; i += 100) {
      const chunk = recipients.slice(i, i + 100);
      const msgs = chunk.map((r) => {
        const unsubscribeUrl = absoluteUrl(`/alerts/unsubscribe?token=${r.unsubscribe_token}`);
        const oneClick = absoluteUrl(`/api/unsubscribe?token=${r.unsubscribe_token}`);
        return {
          to: r.email,
          ...digestEmail({ jobs, total, unsubscribeUrl }),
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        };
      });
      const res = await sendBatch(msgs);
      sent += res.sent;
      failed += res.failed;
      errors.push(...res.errors);
      if (res.sent === chunk.length) {
        await sql`update subscribers set last_digest_at = now() where id = any(${chunk.map((c) => c.id)})`;
      }
    }

    const message = errors.length ? errors.slice(0, 3).join("; ") : null;
    await sql`
      update digests set status = ${failed && !sent ? "failed" : "done"}, recipients = ${recipients.length}, sent = ${sent},
        failed = ${failed}, message = ${message}, finished_at = now()
      where period_key = ${periodKey}`;
    return { status: failed && !sent ? "failed" : "sent", periodKey, recipients: recipients.length, sent, failed, jobs: total, message };
  } finally {
    await releaseLock("digest", holder);
  }
}

// ── Paid email alerts ────────────────────────────────────────

/** Matches listed per saved search in one email (the rest are behind a "See all" link). */
const JOBS_PER_SEARCH = 10;
/** A daily subscriber gets at most one email in this many hours; a weekly one in 6.5 days. Runs drift by minutes, so not 24h / 7d. */
const MIN_HOURS_BETWEEN = { daily: 20, weekly: 156 } as const;
/** First email for a search: vacancies first seen in the last day or week. */
const FIRST_WINDOW_HOURS = { daily: 24, weekly: 7 * 24 } as const;
/** Never look back further than this (e.g. after a paused subscription resumes). */
const MAX_WINDOW_HOURS = { daily: 7 * 24, weekly: 14 * 24 } as const;

export type AlertsResult = { status: "sent" | "skipped" | "failed"; due: number; sent: number; failed: number; empty: number; message: string | null };

type DueRow = { id: number; email: string; frequency: "daily" | "weekly"; manage_token: string; unsubscribe_token: string };
type SearchRow = { id: number; subscriber_id: number; search: string; label: string | null; last_sent_at: Date | null };

/**
 * Sends paid alerts to subscribers in trial or paying (billing_status
 * trialing/active) who are due by their frequency. For each saved search it
 * looks for open vacancies first seen after the search's last_sent_at (or the
 * last 24 hours / 7 days for a new search) and up to the start of this run.
 * Subscribers with no new matches get nothing and stay due. After a
 * successful send every search of that subscriber gets last_sent_at = the
 * run's start time, so nothing is sent twice and nothing falls between runs.
 */
export async function runAlerts(opts: { limit?: number } = {}): Promise<AlertsResult> {
  const base: AlertsResult = { status: "skipped", due: 0, sent: 0, failed: 0, empty: 0, message: null };
  if (!isEmailConfigured()) return { ...base, message: "Email sending is not configured (RESEND_API_KEY missing)." };

  const holder = `alerts-${Date.now()}`;
  if (!(await acquireLock("digest", holder, 15))) return { ...base, message: "Emails are already being sent." };
  try {
    // One clock for the whole run: the database's.
    const [{ now }] = await sql<{ now: Date }[]>`select now() as now`;
    const due = await sql<DueRow[]>`
      select s.id::int as id, s.email, s.frequency, s.manage_token, s.unsubscribe_token
      from subscribers s
      where s.status = 'confirmed' and s.billing_status in ('trialing', 'active')
        and exists (select 1 from saved_searches ss where ss.subscriber_id = s.id)
        and coalesce((select max(ss.last_sent_at) from saved_searches ss where ss.subscriber_id = s.id), '-infinity'::timestamptz)
            <= ${now}::timestamptz - make_interval(hours => case when s.frequency = 'daily' then ${MIN_HOURS_BETWEEN.daily}::int else ${MIN_HOURS_BETWEEN.weekly}::int end)
      order by s.id
      limit ${opts.limit ?? 5000}`;
    if (due.length === 0) return { ...base, status: "sent", message: "No subscribers due." };

    const searches = await sql<SearchRow[]>`
      select id::int as id, subscriber_id::int as subscriber_id, search, label, last_sent_at
      from saved_searches where subscriber_id = any(${due.map((d) => d.id)}) order by created_at, id`;

    let sent = 0, failed = 0, empty = 0;
    const errors: string[] = [];
    const outbox: { sub: DueRow; msg: Parameters<typeof sendBatch>[0][number] }[] = [];

    const flush = async () => {
      if (!outbox.length) return;
      const chunk = outbox.splice(0, outbox.length);
      const res = await sendBatch(chunk.map((o) => o.msg));
      sent += res.sent;
      failed += res.failed;
      errors.push(...res.errors);
      if (res.sent === chunk.length) {
        await sql`update saved_searches set last_sent_at = ${now} where subscriber_id = any(${chunk.map((o) => o.sub.id)})`;
      }
    };

    for (const sub of due) {
      const groups: AlertGroup[] = [];
      for (const s of searches.filter((x) => x.subscriber_id === sub.id)) {
        const firstHours = FIRST_WINDOW_HOURS[sub.frequency] ?? FIRST_WINDOW_HOURS.weekly;
        const maxHours = MAX_WINDOW_HOURS[sub.frequency] ?? MAX_WINDOW_HOURS.weekly;
        const since = new Date(Math.max(
          s.last_sent_at ? new Date(s.last_sent_at).getTime() : now.getTime() - firstHours * 3_600_000,
          now.getTime() - maxHours * 3_600_000,
        ));
        const filters = parseFilters(Object.fromEntries(new URLSearchParams(s.search)));
        const res = await searchJobs({ ...filters, page: undefined, posted: undefined, sort: "newest", firstSeenAfter: since, firstSeenUntil: now, excludeDemo: true }, JOBS_PER_SEARCH);
        if (res.total === 0) continue;
        // "See all" opens the search on the site, limited to the last day or week (close to, not exactly, the email's window).
        const posted = sub.frequency === "daily" ? "1" : "7";
        groups.push({
          label: s.label || "All new vacancies",
          url: absoluteUrl(jobsUrl({ ...filters, page: undefined, sort: undefined, posted })) + "&utm_source=alert&utm_medium=email",
          jobs: res.items,
          total: res.total,
        });
      }
      if (groups.length === 0) { empty++; continue; }
      const accountUrl = absoluteUrl(`/account?t=${sub.manage_token}`);
      const unsubscribeUrl = absoluteUrl(`/alerts/unsubscribe?token=${sub.unsubscribe_token}`);
      const oneClick = absoluteUrl(`/api/unsubscribe?token=${sub.unsubscribe_token}`);
      outbox.push({
        sub,
        msg: {
          to: sub.email,
          ...alertEmail({ groups, frequency: sub.frequency, accountUrl, unsubscribeUrl }),
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        },
      });
      if (outbox.length >= 100) await flush();
    }
    await flush();

    const message = errors.length ? errors.slice(0, 3).join("; ") : null;
    return { status: failed && !sent ? "failed" : "sent", due: due.length, sent, failed, empty, message };
  } finally {
    await releaseLock("digest", holder);
  }
}
