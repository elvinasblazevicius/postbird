import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/site";
import { recordEvent } from "@/lib/analytics";
import { hashKey } from "@/lib/rate-limit";
import type { BillingStatus, PlanInterval } from "@/lib/billing/subscriptions";

export type SignupKind = "alerts" | "waitlist";

export type SignupResult =
  | { ok: true; state: "check_email" | "email_not_configured" }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const token = () => randomBytes(24).toString("base64url");

type SubRow = { id: number; status: string; confirm_token: string | null; confirm_sent_at: Date | null; wants_alerts: boolean; premium_waitlist: boolean };

/**
 * Double opt-in sign-up. New addresses are stored as "pending". For an
 * address that already exists, the requested changes are only stored as
 * pending and applied when the owner clicks the confirmation link, so nobody
 * can change someone else's subscription. The reply is the same either way,
 * so the form can't be used to find out who is subscribed.
 */
export async function signup(opts: { email: string; kind: SignupKind; source?: string; note?: string; preferences?: Record<string, string>; attribution?: Record<string, string> | null; visitor?: string | null }): Promise<SignupResult> {
  const email = normalizeEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const isWaitlist = opts.kind === "waitlist";
  const note = opts.note?.trim().slice(0, 500) || null;
  const prefs = opts.preferences && Object.keys(opts.preferences).length ? opts.preferences : null;
  const attribution = opts.attribution ?? null;

  await recordEvent({ type: isWaitlist ? "waitlist_signup" : "alert_signup", visitor: opts.visitor ?? null, props: { source: opts.source ?? null, ...(attribution ? { campaign: attribution } : {}) } });

  const existing = (await sql<SubRow[]>`
    select id, status, confirm_token, confirm_sent_at, wants_alerts, premium_waitlist from subscribers where email = ${email}`)[0];

  if (existing) {
    const change = { wants_alerts: !isWaitlist, premium_waitlist: isWaitlist, note, preferences: prefs ?? {} };
    const confirmToken = existing.confirm_token ?? token();
    await sql`
      update subscribers set
        confirm_token = ${confirmToken},
        pending_changes = jsonb_build_object(
          'wants_alerts', coalesce((pending_changes->>'wants_alerts')::boolean, false) or ${change.wants_alerts},
          'premium_waitlist', coalesce((pending_changes->>'premium_waitlist')::boolean, false) or ${change.premium_waitlist},
          'note', coalesce(${note}::text, pending_changes->>'note'),
          'preferences', coalesce(pending_changes->'preferences', '{}'::jsonb) || ${sql.json(change.preferences)}
        ),
        attribution = coalesce(attribution, ${attribution ? sql.json(attribution) : null})
      where id = ${existing.id}`;
    // Don't send more than one confirmation email every 5 minutes (protects against abuse).
    const recentlySent = existing.confirm_sent_at && Date.now() - new Date(existing.confirm_sent_at).getTime() < 5 * 60_000;
    if (recentlySent) return { ok: true, state: isEmailConfigured() ? "check_email" : "email_not_configured" };
    return sendConfirmation(existing.id, email, confirmToken, existing.premium_waitlist || isWaitlist, existing.wants_alerts || !isWaitlist);
  }

  const confirmToken = token();
  const [row] = await sql<{ id: number }[]>`
    insert into subscribers (email, status, wants_alerts, premium_waitlist, waitlist_note, preferences, confirm_token, unsubscribe_token, source, waitlist_joined_at, attribution)
    values (${email}, 'pending', ${!isWaitlist}, ${isWaitlist}, ${note}, ${sql.json(prefs ?? {})}, ${confirmToken}, ${token()}, ${opts.source ?? null},
            ${isWaitlist ? new Date() : null}, ${attribution ? sql.json(attribution) : null})
    on conflict (email) do nothing
    returning id`;
  if (!row) return { ok: true, state: isEmailConfigured() ? "check_email" : "email_not_configured" }; // created at the same moment by another request
  return sendConfirmation(row.id, email, confirmToken, isWaitlist, !isWaitlist);
}

/** At most this many confirmation emails per address in any 24 hours (on top of the 5-minute gap). */
export const CONFIRMATIONS_PER_DAY = 3;

/**
 * Counts one confirmation email for this address, unless it already had
 * CONFIRMATIONS_PER_DAY in the last 24 hours (then false: don't send). Stored
 * in rate_limits as a salted hash of the address, one row per email, and
 * deleted after 24 hours like every rate-limit row.
 */
async function takeDailyConfirmation(email: string): Promise<boolean> {
  const key = hashKey(`confirm-email|${email}`);
  const rows = await sql`
    insert into rate_limits (key, window_start, count)
    select ${key}, clock_timestamp(), 1
    where (select count(*) from rate_limits where key = ${key} and window_start > now() - interval '24 hours') < ${CONFIRMATIONS_PER_DAY}
    on conflict (key, window_start) do nothing
    returning 1`;
  return rows.length === 1;
}

async function sendConfirmation(id: number, email: string, confirmToken: string, waitlist: boolean, alerts: boolean): Promise<SignupResult> {
  // Same reply as a sent email, so the form doesn't reveal anything about the address.
  if (isEmailConfigured() && !(await takeDailyConfirmation(email))) return { ok: true, state: "check_email" };
  const confirmUrl = absoluteUrl(`/alerts/confirm?token=${encodeURIComponent(confirmToken)}`);
  const sent = await sendEmail({ to: email, ...confirmationEmail({ confirmUrl, waitlist, alerts }) });
  await sql`update subscribers set confirm_sent_at = now() where id = ${id}`;
  if (sent.skipped) return { ok: true, state: "email_not_configured" };
  if (!sent.ok) return { ok: false, error: "We couldn't send the confirmation email. Please try again in a few minutes." };
  return { ok: true, state: "check_email" };
}

export async function findByConfirmToken(t: string) {
  if (!t || t.length > 100) return null;
  return (await sql<{ id: number; email: string; status: string }[]>`select id, email, status from subscribers where confirm_token = ${t}`)[0] ?? null;
}

/** Confirms the address and applies any changes that were waiting for confirmation. */
export type ConfirmResult = { ok: false } | { ok: true; waitlist: boolean; alerts: boolean; paidPlan: boolean };

export async function confirmSubscriber(t: string): Promise<ConfirmResult> {
  if (!t || t.length > 100) return { ok: false };
  const rows = await sql<{ id: number; premium_waitlist: boolean; wants_alerts: boolean; paid_plan: boolean }[]>`
    update subscribers set
      wants_alerts = case when status = 'unsubscribed' then coalesce((pending_changes->>'wants_alerts')::boolean, wants_alerts)
                          else wants_alerts or coalesce((pending_changes->>'wants_alerts')::boolean, false) end,
      premium_waitlist = case when status = 'unsubscribed' then coalesce((pending_changes->>'premium_waitlist')::boolean, premium_waitlist)
                              else premium_waitlist or coalesce((pending_changes->>'premium_waitlist')::boolean, false) end,
      waitlist_joined_at = case when coalesce((pending_changes->>'premium_waitlist')::boolean, false) and waitlist_joined_at is null then now() else waitlist_joined_at end,
      waitlist_note = coalesce(pending_changes->>'note', waitlist_note),
      preferences = preferences || coalesce(pending_changes->'preferences', '{}'::jsonb),
      pending_changes = null,
      status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      unsubscribed_at = null,
      confirm_token = null
    where confirm_token = ${t}
    returning id, premium_waitlist, wants_alerts, billing_status in ('trialing', 'active') as paid_plan`;
  if (rows.length !== 1) return { ok: false };
  await recordEvent({ type: "alert_confirmed" });
  return { ok: true, waitlist: rows[0].premium_waitlist, alerts: rows[0].wants_alerts, paidPlan: rows[0].paid_plan };
}

/**
 * Privacy-policy retention, run by the scheduled job (every 2 hours):
 *  - sign-ups never confirmed, and unsubscribed addresses: 30 days;
 *  - canceled plans: 30 days after the cancellation took effect (Paddle, the
 *    reseller, keeps the payment records);
 *  - early-access-only addresses: 30 days after the "alerts are open" email,
 *    unless they started a trial.
 * Saved searches and checkout references go with the subscriber (on delete cascade).
 */
export async function purgeStaleSubscribers(): Promise<number> {
  // Never deletes someone with a running Paddle subscription (they still pay,
  // even if they unsubscribed from the emails) or one canceled in the last 30 days.
  const stale = await sql`
    delete from subscribers
    where coalesce(confirm_sent_at, created_at) < now() - interval '30 days'
      and (status = 'pending' or (status = 'unsubscribed' and unsubscribed_at < now() - interval '30 days'))
      and billing_status in ('none', 'canceled')
      and (canceled_at is null or canceled_at < now() - interval '30 days')
    returning id`;
  const canceled = await sql`
    delete from subscribers
    where billing_status = 'canceled'
      and coalesce(canceled_at, billing_event_at) < now() - interval '30 days'
    returning id`;
  // Early access only: on the list, never asked for the free weekly email, never had a plan.
  const waitlist = await sql`
    delete from subscribers
    where premium_waitlist and not wants_alerts
      and billing_status = 'none' and paddle_subscription_id is null
      and waitlist_notified_at < now() - interval '30 days'
    returning id`;
  // Checkout references (they link a daily visitor hash to a subscriber) are only
  // needed until Paddle's webhooks arrive; webhook ids for a year (late retries).
  await sql`delete from paddle_checkouts where created_at < now() - interval '30 days'`;
  await sql`delete from paddle_events where received_at < now() - interval '365 days'`;
  return stale.length + canceled.length + waitlist.length;
}

export type UnsubscribeTarget = {
  id: number;
  email: string;
  status: string;
  billing_status: BillingStatus;
  plan_interval: PlanInterval | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  cancel_at: Date | null;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
};

export async function findByUnsubscribeToken(t: string): Promise<UnsubscribeTarget | null> {
  if (!t || t.length > 100) return null;
  return (await sql<UnsubscribeTarget[]>`
    select id::int as id, email, status, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at,
           paddle_customer_id, paddle_subscription_id
    from subscribers where unsubscribe_token = ${t}`)[0] ?? null;
}

/** Stops all alert emails. Returns the subscriber's id when this changed something, else null. */
export async function unsubscribe(t: string): Promise<number | null> {
  if (!t || t.length > 100) return null;
  const rows = await sql<{ id: number }[]>`
    update subscribers set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null, pending_changes = null
    where unsubscribe_token = ${t} and status <> 'unsubscribed' returning id::int as id`;
  return rows.length === 1 ? rows[0].id : null;
}
