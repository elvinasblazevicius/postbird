/** Weekly email digest to confirmed alert subscribers. */
import siteConfig from "@site-config";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendBatch } from "@/lib/email";
import { digestEmail } from "@/lib/email-templates";
import { acquireLock, releaseLock } from "@/lib/feeds/sync";
import type { JobListItem } from "@/lib/jobs";
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
        and (${siteConfig.freeWeeklyEmail} or plan = 'premium')
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
