import { randomBytes } from "node:crypto";
import { sql, transaction, type Tx } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/site";
import { recordEvent } from "@/lib/analytics";
import { takeDailyQuota } from "@/lib/rate-limit";
import { replaceWithWeeklySearch } from "@/lib/saved-searches";
import { storeMarkerFingerprint, writeTrialMarkers } from "@/lib/billing/trial-markers";
import { sharedSecret } from "@/lib/server-secret";
import type { BillingStatus, PlanInterval } from "@/lib/billing/subscriptions";

export type SignupKind = "alerts" | "waitlist";

export type SignupResult =
  | { ok: true; state: "check_email" | "email_not_configured" }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Control characters (NUL, line breaks, DEL…): never part of an address, and Postgres rejects NUL in text. */
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizeEmail(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && !CONTROL_RE.test(e) && EMAIL_RE.test(e) ? e : null;
}

const token = () => randomBytes(24).toString("base64url");

/**
 * Confirmation and unsubscribe tokens: randomBytes(24) as base64url, 32
 * characters of [A-Za-z0-9_-]. The pattern allows 20–64 such characters;
 * anything else (an array from a repeated parameter, NUL bytes, other
 * characters) is not looked up at all.
 */
export function isLinkToken(t: unknown): t is string {
  return typeof t === "string" && /^[\w-]{20,64}$/.test(t);
}

type SubRow = { id: number; status: string; confirm_token: string | null; confirm_sent_at: Date | null; wants_alerts: boolean; premium_waitlist: boolean };

/**
 * Double opt-in sign-up. New addresses are stored as "pending". For an
 * address that already exists, the requested changes are only stored as
 * pending and applied when the owner clicks the confirmation link, so nobody
 * can change someone else's subscription. The reply is the same either way,
 * so the form can't be used to find out who is subscribed.
 *
 * weeklySearch: a sign-up for the free weekly email, with the saved search it
 * should follow ("" = the week's newest vacancies). It is kept in
 * pending_changes and becomes the subscriber's saved search on confirmation.
 */
export async function signup(opts: { email: string; kind: SignupKind; source?: string; note?: string; preferences?: Record<string, string>; weeklySearch?: string | null; attribution?: Record<string, string> | null; visitor?: string | null }): Promise<SignupResult> {
  const email = normalizeEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const isWaitlist = opts.kind === "waitlist";
  const note = opts.note?.trim().slice(0, 500) || null;
  const prefs = opts.preferences && Object.keys(opts.preferences).length ? opts.preferences : null;
  const attribution = opts.attribution ?? null;
  const weeklySearch = !isWaitlist && typeof opts.weeklySearch === "string" ? opts.weeklySearch : null;

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
        ) || case when ${weeklySearch}::text is null then coalesce(pending_changes, '{}'::jsonb) - array['wants_alerts', 'premium_waitlist', 'note', 'preferences']
                  else jsonb_build_object('weekly_search', ${weeklySearch}::text) end,
        attribution = coalesce(attribution, ${attribution ? sql.json(attribution) : null})
      where id = ${existing.id}`;
    // Don't send more than one confirmation email every 5 minutes (protects against abuse).
    const recentlySent = existing.confirm_sent_at && Date.now() - new Date(existing.confirm_sent_at).getTime() < 5 * 60_000;
    if (recentlySent) return { ok: true, state: isEmailConfigured() ? "check_email" : "email_not_configured" };
    return sendConfirmation(existing.id, email, confirmToken, existing.premium_waitlist || isWaitlist, existing.wants_alerts || !isWaitlist);
  }

  const confirmToken = token();
  const [row] = await sql<{ id: number }[]>`
    insert into subscribers (email, status, wants_alerts, premium_waitlist, waitlist_note, preferences, confirm_token, unsubscribe_token, source, waitlist_joined_at, attribution, pending_changes)
    values (${email}, 'pending', ${!isWaitlist}, ${isWaitlist}, ${note}, ${sql.json(prefs ?? {})}, ${confirmToken}, ${token()}, ${opts.source ?? null},
            ${isWaitlist ? new Date() : null}, ${attribution ? sql.json(attribution) : null},
            ${weeklySearch === null ? null : sql.json({ weekly_search: weeklySearch })})
    on conflict (email) do nothing
    returning id`;
  if (!row) return { ok: true, state: isEmailConfigured() ? "check_email" : "email_not_configured" }; // created at the same moment by another request
  return sendConfirmation(row.id, email, confirmToken, isWaitlist, !isWaitlist);
}

/** At most this many confirmation emails per address in any 24 hours (on top of the 5-minute gap). */
export const CONFIRMATIONS_PER_DAY = 3;

/**
 * Counts one confirmation email for this address, unless it already had
 * CONFIRMATIONS_PER_DAY in the last 24 hours (then false: don't send). See
 * takeDailyQuota in src/lib/rate-limit.ts.
 */
async function takeDailyConfirmation(email: string): Promise<boolean> {
  return takeDailyQuota(`confirm-email|${email}`, CONFIRMATIONS_PER_DAY);
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

export async function findByConfirmToken(t: unknown) {
  if (!isLinkToken(t)) return null;
  return (await sql<{ id: number; email: string; status: string }[]>`select id, email, status from subscribers where confirm_token = ${t}`)[0] ?? null;
}

/**
 * Confirms the address and applies any changes that were waiting for
 * confirmation. A confirmed free weekly sign-up (pending_changes.weekly_search)
 * switches the weekly email on and, unless the address has a plan, makes that
 * search its one saved search.
 */
export type ConfirmResult = { ok: false } | { ok: true; id: number; waitlist: boolean; alerts: boolean; weekly: boolean; paidPlan: boolean };

export async function confirmSubscriber(t: unknown): Promise<ConfirmResult> {
  if (!isLinkToken(t)) return { ok: false };
  const rows = await transaction(async (tx) => {
    const updated = await tx<{ id: number; premium_waitlist: boolean; wants_alerts: boolean; weekly_email: boolean; paid_plan: boolean; plan_live: boolean; weekly_search: string | null }[]>`
    with prev as (
      select id, status as prev_status, pending_changes as prev_changes from subscribers where confirm_token = ${t} for update
    )
    update subscribers set
      wants_alerts = case when status = 'unsubscribed' then coalesce((pending_changes->>'wants_alerts')::boolean, wants_alerts)
                          else wants_alerts or coalesce((pending_changes->>'wants_alerts')::boolean, false) end,
      premium_waitlist = case when status = 'unsubscribed' then coalesce((pending_changes->>'premium_waitlist')::boolean, premium_waitlist)
                              else premium_waitlist or coalesce((pending_changes->>'premium_waitlist')::boolean, false) end,
      waitlist_joined_at = case when coalesce((pending_changes->>'premium_waitlist')::boolean, false) and waitlist_joined_at is null then now() else waitlist_joined_at end,
      waitlist_note = coalesce(pending_changes->>'note', waitlist_note),
      preferences = preferences || coalesce(pending_changes->'preferences', '{}'::jsonb),
      weekly_email = case when status = 'unsubscribed' then coalesce(pending_changes ? 'weekly_search', false)
                          else weekly_email or coalesce(pending_changes ? 'weekly_search', false) end,
      pending_changes = null,
      status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      unsubscribed_at = null,
      confirm_token = null
    from prev
    where subscribers.id = prev.id
    returning subscribers.id::int as id, premium_waitlist, wants_alerts, weekly_email,
              billing_status in ('trialing', 'active') as paid_plan,
              billing_status in ('trialing', 'active', 'past_due', 'paused') as plan_live,
              prev.prev_changes->>'weekly_search' as weekly_search`;
    const row = updated[0];
    // The free weekly email follows one search: the one just chosen. A plan keeps its own searches.
    if (row && row.weekly_search !== null && !row.plan_live) await replaceWithWeeklySearch(row.id, row.weekly_search, tx);
    return updated;
  });
  if (rows.length !== 1) return { ok: false };
  await recordEvent({ type: "alert_confirmed" });
  return { ok: true, id: rows[0].id, waitlist: rows[0].premium_waitlist, alerts: rows[0].wants_alerts, weekly: rows[0].weekly_search !== null, paidPlan: rows[0].paid_plan };
}

/**
 * Privacy-policy retention, run by the scheduled job (every 2 hours):
 *  - sign-ups never confirmed (including checkouts never finished), and
 *    unsubscribed addresses: 30 days;
 *  - canceled plans: 30 days after the cancellation took effect (Paddle, the
 *    reseller, keeps the payment records), unless the address also signed up
 *    for the free weekly email and is still subscribed to it;
 *  - early-access-only addresses: 30 days after the "alerts are open" email,
 *    unless they started a trial.
 * Saved searches, checkout references and checkout links go with the
 * subscriber (on delete cascade). A deleted address that had a plan while
 * confirmed leaves a trial marker (a one-way code, not the address) for 24
 * months, so it can't get a second free trial (see
 * src/lib/billing/trial-markers.ts); markers are deleted once they expire.
 * A plan at an address that was never confirmed leaves none (its owner never
 * proved the address, so it doesn't use up their trial).
 *
 * Without ANALYTICS_SALT or CRON_SECRET no marker can be written: addresses
 * that would need one are kept (not deleted) and an error is logged in the
 * GitHub Actions run, until the secret is set.
 */
export async function purgeStaleSubscribers(): Promise<number> {
  const canMark = sharedSecret() !== null;
  if (!canMark) {
    console.error("::error title=Trial markers::Neither ANALYTICS_SALT nor CRON_SECRET is set, so no trial marker can be written. Addresses that had a plan are kept until it is set (use exactly the same values on Netlify and in GitHub).");
  } else {
    // Lets Admin → Overview check that the website uses the same secret.
    await storeMarkerFingerprint();
  }
  // Each delete and the markers of the addresses it removed commit together.
  // "Had a plan" is the same test as hadTrialBefore in src/lib/billing/subscriptions.ts.
  type Deleted = { email: string; had_plan: boolean }[];
  const purge = (del: (tx: Tx) => Promise<Deleted>) => transaction(async (tx) => {
    const rows = await del(tx);
    const toMark = rows.filter((r) => r.had_plan).map((r) => r.email);
    if (toMark.length && !(await writeTrialMarkers(tx, toMark))) throw new Error("trial markers could not be written");
    return rows.length;
  });
  // Never deletes someone with a running Paddle subscription (they still pay,
  // even if they unsubscribed from the emails) or one canceled in the last 30 days.
  const stale = await purge((tx) => tx<Deleted>`
    delete from subscribers
    where coalesce(confirm_sent_at, created_at) < now() - interval '30 days'
      and (status = 'pending' or (status = 'unsubscribed' and unsubscribed_at < now() - interval '30 days'))
      and billing_status in ('none', 'canceled')
      and (canceled_at is null or canceled_at < now() - interval '30 days')
      and (${canMark}::boolean or not (confirmed_at is not null and (paddle_subscription_id is not null or billing_status <> 'none' or trial_ends_at is not null or canceled_at is not null)))
    returning email, (confirmed_at is not null and (paddle_subscription_id is not null or billing_status <> 'none' or trial_ends_at is not null or canceled_at is not null)) as had_plan`);
  const canceled = await purge((tx) => tx<Deleted>`
    delete from subscribers
    where billing_status = 'canceled'
      and coalesce(canceled_at, billing_event_at) < now() - interval '30 days'
      and not (weekly_email and status = 'confirmed')
      and (${canMark}::boolean or confirmed_at is null)
    returning email, (confirmed_at is not null and (paddle_subscription_id is not null or billing_status <> 'none' or trial_ends_at is not null or canceled_at is not null)) as had_plan`);
  // Early access only: on the list, never asked for the free weekly email, never had a plan.
  const waitlist = await purge((tx) => tx<Deleted>`
    delete from subscribers
    where premium_waitlist and not wants_alerts and not weekly_email
      and billing_status = 'none' and paddle_subscription_id is null
      and waitlist_notified_at < now() - interval '30 days'
      and (${canMark}::boolean or not (confirmed_at is not null and (trial_ends_at is not null or canceled_at is not null)))
    returning email, (confirmed_at is not null and (paddle_subscription_id is not null or billing_status <> 'none' or trial_ends_at is not null or canceled_at is not null)) as had_plan`);
  // Checkout references (they link a daily visitor code to a subscriber) are only
  // needed until Paddle's webhooks arrive; webhook ids for a year (late retries).
  await sql`delete from paddle_checkouts where created_at < now() - interval '30 days'`;
  await sql`delete from paddle_events where received_at < now() - interval '365 days'`;
  // Emailed checkout links work for 24 hours; trial markers are kept 24 months.
  await sql`delete from checkout_links where expires_at < now()`;
  await sql`delete from trial_markers where expires_at < now()`;
  return stale + canceled + waitlist;
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

export async function findByUnsubscribeToken(t: unknown): Promise<UnsubscribeTarget | null> {
  if (!isLinkToken(t)) return null;
  return (await sql<UnsubscribeTarget[]>`
    select id::int as id, email, status, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at,
           paddle_customer_id, paddle_subscription_id
    from subscribers where unsubscribe_token = ${t}`)[0] ?? null;
}

/** Stops all alert emails. Returns the subscriber's id when this changed something, else null. */
export async function unsubscribe(t: unknown): Promise<number | null> {
  if (!isLinkToken(t)) return null;
  const rows = await sql<{ id: number }[]>`
    update subscribers set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null, pending_changes = null
    where unsubscribe_token = ${t} and status <> 'unsubscribed' returning id::int as id`;
  return rows.length === 1 ? rows[0].id : null;
}
