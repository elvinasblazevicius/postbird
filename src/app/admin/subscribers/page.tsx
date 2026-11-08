import { sql } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { resendConfirmationsAction, sendDigestNowAction } from "../actions";
import { requireAdmin } from "../guard";
import { AdminShell, Card, fmtDateTime, Stat, StatusPill, Table } from "../ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ msg?: string }> };

export default async function SubscribersPage({ searchParams }: Props) {
  await requireAdmin();
  const msg = (await searchParams).msg;
  const [[c], recent, digests] = await Promise.all([
    sql<{ alerts: number; pending: number; waitlist: number; waitlist_all: number; unsub: number; total: number }[]>`
      select count(*) filter (where status = 'confirmed' and wants_alerts)::int as alerts,
             count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'confirmed' and premium_waitlist)::int as waitlist,
             count(*) filter (where premium_waitlist and status <> 'unsubscribed')::int as waitlist_all,
             count(*) filter (where status = 'unsubscribed')::int as unsub,
             count(*)::int as total
      from subscribers`,
    sql<{ email: string; status: string; wants_alerts: boolean; premium_waitlist: boolean; source: string | null; created_at: Date; preferences: Record<string, string>; waitlist_note: string | null }[]>`
      select email, status, wants_alerts, premium_waitlist, source, created_at, preferences, waitlist_note from subscribers order by id desc limit 100`,
    sql<{ period_key: string; status: string; recipients: number; sent: number; failed: number; jobs_included: number; started_at: Date; message: string | null }[]>`
      select period_key, status, recipients, sent, failed, jobs_included, started_at, message from digests order by id desc limit 8`,
  ]);
  const emailOn = isEmailConfigured();

  return (
    <AdminShell title="Subscribers" active="/admin/subscribers">
      {msg ? <Card className="mb-6 text-sm text-ink">{msg === "email-not-configured" ? "Email isn't set up yet (RESEND_API_KEY missing)." : msg.replace(/-/g, " ")}</Card> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed alert subscribers" value={c.alerts} />
        <Stat label="Premium waitlist (confirmed)" value={c.waitlist} hint={`${c.waitlist_all} including unconfirmed`} />
        <Stat label="Awaiting confirmation" value={c.pending} />
        <Stat label="Unsubscribed" value={c.unsub} hint={`${c.total} addresses in total`} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={resendConfirmationsAction}>
          <button disabled={!emailOn} className="rounded-lg border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-mist disabled:opacity-50">Send confirmation emails to unconfirmed sign-ups</button>
        </form>
        <form action={sendDigestNowAction}>
          <button disabled={!emailOn} className="rounded-lg border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-mist disabled:opacity-50">Send this week&apos;s digest now</button>
        </form>
        <a href="/admin/subscribers/export" className="rounded-lg border border-rule bg-paper px-4 py-2 text-sm font-medium text-ink hover:bg-mist">Download CSV</a>
      </div>
      {!emailOn ? <p className="mt-2 text-sm text-slate">Email buttons turn on once RESEND_API_KEY is set and your domain is verified in Resend.</p> : null}

      <h2 className="mt-10 text-xl font-semibold text-ink">Weekly digests</h2>
      <div className="mt-3">
        <Table head={["Week", "Status", "Recipients", "Sent", "Failed", "New jobs", "Started", "Note"]}>
          {digests.map((d) => (
            <tr key={d.period_key}>
              <td className="px-4 py-2">{d.period_key}</td><td className="px-4 py-2"><StatusPill status={d.status} /></td>
              <td className="px-4 py-2 tabular-nums">{d.recipients}</td><td className="px-4 py-2 tabular-nums">{d.sent}</td><td className="px-4 py-2 tabular-nums">{d.failed}</td>
              <td className="px-4 py-2 tabular-nums">{d.jobs_included}</td><td className="px-4 py-2">{fmtDateTime(d.started_at)}</td><td className="px-4 py-2 text-xs text-slate">{d.message}</td>
            </tr>
          ))}
          {digests.length === 0 ? <tr><td colSpan={8} className="px-4 py-3 text-slate">No digests sent yet.</td></tr> : null}
        </Table>
      </div>

      <h2 className="mt-10 text-xl font-semibold text-ink">Latest sign-ups</h2>
      <div className="mt-3">
        <Table head={["Email", "Status", "Wants", "Source", "Premium interests", "Joined"]}>
          {recent.map((s) => (
            <tr key={s.email} className="align-top">
              <td className="px-4 py-2">{s.email}</td>
              <td className="px-4 py-2"><StatusPill status={s.status} /></td>
              <td className="px-4 py-2">{[s.wants_alerts && "weekly alerts", s.premium_waitlist && "premium"].filter(Boolean).join(", ")}</td>
              <td className="px-4 py-2 text-slate">{s.source ?? "—"}</td>
              <td className="max-w-xs px-4 py-2 text-xs text-slate">
                {Object.entries(s.preferences ?? {}).filter(([k]) => ["keywords", "organizations", "locations"].includes(k)).map(([k, v]) => `${k}: ${v}`).join(" | ")}
                {s.waitlist_note ? <div className="mt-1 text-ink">“{s.waitlist_note}”</div> : null}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(s.created_at)}</td>
            </tr>
          ))}
          {recent.length === 0 ? <tr><td colSpan={6} className="px-4 py-3 text-slate">No sign-ups yet.</td></tr> : null}
        </Table>
      </div>
    </AdminShell>
  );
}
