/**
 * Emails about a subscriber's plan (server only). The daily jobs claim a row
 * (*_sent_at, with a lease in *_claimed_at) before sending and give it back if
 * sending fails, so two runs at once can't both send; a claim left open past
 * CLAIM_LEASE_MINUTES (the process died mid-send) is picked up again under the
 * same idempotency key, so an email that did go out isn't sent twice.
 */
import siteConfig from "@site-config";
import { accountUrl } from "@/lib/account";
import { BILLING_LIVE } from "@/lib/billing/live";
import { trialUsedElsewhereIds } from "@/lib/billing/trial-markers";
import {
  LIVE_STATUSES, UNCONFIRMED_CANCEL_DAYS, welcomeTrialEnd, type BillingStatus, type ConfirmInfo, type ConfirmSendDay, type PlanInterval, type WelcomeInfo,
} from "@/lib/billing/subscriptions";
import { sql } from "@/lib/db";
import { planDescription } from "@/lib/early-access-copy";
import { batchKey, isEmailConfigured, sendBatch, sendEmail, type OutgoingEmail, type SendResult } from "@/lib/email";
import { alertsOpenEmail, paidConfirmationEmail, planStillActiveEmail, trialReminderEmail, welcomeEmail } from "@/lib/email-templates";
import { absoluteUrl, formatDate } from "@/lib/site";

/** The price of one billing period, e.g. "$19.99" (site.config.ts: plans[0] monthly, plans[1] 3 months). */
export function planPrice(interval: PlanInterval | null): string {
  const [m, q] = siteConfig.premium.plans;
  if (interval === "quarter") return q.price;
  if (interval === "month") return m.price;
  return siteConfig.premium.priceSummary;
}

/** How often a plan of this interval renews, after its price: "per month" or "every 3 months". */
export function planPeriod(interval: PlanInterval | null): string {
  const [m, q] = siteConfig.premium.plans;
  if (interval === "quarter") return `every ${q.per}`;
  if (interval === "month") return `per ${m.per}`;
  return "per period";
}

/** List-Unsubscribe headers for emails that have an unsubscribe link (RFC 8058 one-click). */
export function unsubscribeHeaders(unsubscribeToken: string): Record<string, string> {
  const oneClick = absoluteUrl(`/api/unsubscribe?token=${unsubscribeToken}`);
  return { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export type PlanState = {
  billing_status: BillingStatus;
  plan_interval: PlanInterval | null;
  trial_ends_at: Date | string | null;
  current_period_end: Date | string | null;
  cancel_at: Date | string | null;
};

/**
 * One plain sentence about what happens next with a running plan, whether a
 * payment is still ahead, and whether there is anything left to cancel (a
 * cancellation may already be scheduled). null when there is no running plan.
 */
export function planRenewal(p: PlanState): { sentence: string; chargesAhead: boolean; canCancel: boolean } | null {
  if (!LIVE_STATUSES.includes(p.billing_status)) return null;
  const price = planPrice(p.plan_interval);
  if (p.cancel_at) {
    return { sentence: `Your plan is already canceled and ends on ${formatDate(p.cancel_at)}. Nothing more will be charged.`, chargesAhead: false, canCancel: false };
  }
  if (p.billing_status === "trialing") {
    return {
      sentence: p.trial_ends_at
        ? `Your plan is still active: your free trial ends on ${formatDate(p.trial_ends_at)}, and then your first payment of ${price} is taken.`
        : `Your plan is still active: when your free trial ends, your first payment of ${price} is taken.`,
      chargesAhead: true,
      canCancel: true,
    };
  }
  if (p.billing_status === "active") {
    return {
      sentence: p.current_period_end
        ? `Your plan is still active and renews on ${formatDate(p.current_period_end)} for ${price}.`
        : `Your plan is still active and renews automatically for ${price}.`,
      chargesAhead: true,
      canCancel: true,
    };
  }
  if (p.billing_status === "past_due") {
    return { sentence: `Your plan is still open: a payment of ${price} is overdue, and Paddle, our reseller, will try to take it again.`, chargesAhead: true, canCancel: true };
  }
  return { sentence: "Your plan is paused, so nothing is charged while it stays paused, but it is still open until you cancel it.", chargesAhead: false, canCancel: true };
}

/** Keeps one-by-one sends under Resend's default rate limit (bulk sends use the batch API). */
const SEND_SPACING_MS = 500;
const spaced = (i: number) => (i > 0 ? new Promise((r) => setTimeout(r, SEND_SPACING_MS)) : Promise.resolve());

/** A claimed email not marked as answered by Resend after this long is claimed again (see db/migrations/009_email_claim_leases.sql). */
export const CLAIM_LEASE_MINUTES = 30;

// ── Welcome ──────────────────────────────────────────────────

/** The welcome email with the account link (once per subscription: a returning customer's new plan gets its own). */
export async function sendWelcomeEmail(w: WelcomeInfo): Promise<SendResult> {
  return sendEmail({
    to: w.email,
    ...welcomeEmail({
      accountUrl: accountUrl(w.manageToken),
      unsubscribeUrl: absoluteUrl(`/alerts/unsubscribe?token=${w.unsubscribeToken}`),
      trialEndsAt: w.trialEndsAt,
      plan: planDescription(w.planInterval),
    }),
    headers: unsubscribeHeaders(w.unsubscribeToken),
    idempotencyKey: `welcome:${w.subscriberId}:${w.subscriptionId}`,
  });
}

/**
 * Daily job: welcome emails still owed (sending failed, the address was
 * confirmed later, or a claim's lease ran out). `onlyId`: just that subscriber,
 * right after its owner confirmed the address.
 */
export async function runWelcomeRetries(limit = 200, onlyId: number | null = null): Promise<{ sent: number; failed: number }> {
  // Claim the rows first, so a run started at the same time can't send them too.
  const rows = await sql<{ id: number; email: string; manage_token: string; unsubscribe_token: string; paddle_subscription_id: string; billing_status: BillingStatus; trial_ends_at: Date | null; plan_interval: PlanInterval | null }[]>`
    update subscribers set welcome_sent_at = now(), welcome_claimed_at = now()
    where id in (
      select id from subscribers
      where (welcome_sent_at is null or welcome_claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES}))
        and status = 'confirmed' and billing_status in ('trialing', 'active') and paddle_subscription_id is not null
        and (${onlyId}::bigint is null or id = ${onlyId}::bigint)
      order by id limit ${limit}
    ) and (welcome_sent_at is null or welcome_claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES}))
    returning id::int as id, email, manage_token, unsubscribe_token, paddle_subscription_id, billing_status, trial_ends_at, plan_interval`;
  let sent = 0, failed = 0;
  for (const [i, r] of rows.entries()) {
    await spaced(i);
    const res = await sendWelcomeEmail({
      subscriberId: r.id, subscriptionId: r.paddle_subscription_id, email: r.email, manageToken: r.manage_token, unsubscribeToken: r.unsubscribe_token,
      trialEndsAt: welcomeTrialEnd(r.billing_status, r.trial_ends_at), planInterval: r.plan_interval,
    });
    if (res.ok) {
      sent++;
      await sql`update subscribers set welcome_claimed_at = null where id = ${r.id}`;
    } else {
      failed++;
      await sql`update subscribers set welcome_sent_at = null, welcome_claimed_at = null where id = ${r.id}`;
    }
  }
  return { sent, failed };
}

// ── Confirmation for an address a checkout didn't prove ──────

/**
 * The last day to confirm before a trial at an unconfirmed address is canceled: the daily job
 * cancels it once the trial ends within UNCONFIRMED_CANCEL_DAYS, so confirming before this
 * date always keeps it.
 */
export function confirmDeadline(trialEndsAt: Date | string): string {
  return new Date(new Date(trialEndsAt).getTime() - UNCONFIRMED_CANCEL_DAYS * 86_400_000).toISOString();
}

export async function sendPaidConfirmation(c: ConfirmInfo): Promise<SendResult> {
  const day = c.sendDay ?? "start";
  return sendEmail({
    to: c.email,
    ...paidConfirmationEmail({
      confirmUrl: absoluteUrl(`/alerts/confirm?token=${encodeURIComponent(c.confirmToken)}`),
      accountUrl: accountUrl(c.manageToken),
      trialEndsAt: c.trialEndsAt,
      confirmBy: c.trialEndsAt ? confirmDeadline(c.trialEndsAt) : null,
      price: planPrice(c.planInterval),
      period: planPeriod(c.planInterval),
    }),
    // One key per send day: the first email, and the reminders on days 3 and 10 of the trial.
    idempotencyKey: day === "start" ? `paid-confirm:${c.subscriberId}:${c.subscriptionId}` : `paid-confirm:${c.subscriberId}:${c.subscriptionId}:${day}`,
  });
}

/** Called when the confirmation email failed, so the daily job sends it again. */
export async function confirmationNotSent(subscriberId: number): Promise<void> {
  await sql`update subscribers set confirm_sent_at = null, confirm_claimed_at = null where id = ${subscriberId}`;
}

/** Called once Resend accepted the confirmation email: ends the claim's lease. */
export async function confirmationSent(subscriberId: number): Promise<void> {
  await sql`update subscribers set confirm_claimed_at = null where id = ${subscriberId}`;
}

/** The days of a trial on which the confirmation email is sent again while the address isn't confirmed. */
export const CONFIRM_RESEND_DAYS = [3, 10] as const;

/**
 * Daily job, for running plans still awaiting confirmation (awaiting_confirmation(),
 * migration 017: never-confirmed addresses only, so a sign-up form someone else
 * fills in for a confirmed owner can't trigger these): confirmation emails that
 * failed or whose lease ran out, and the reminders on days 3 and 10 of a trial,
 * each once (the send day is part of the idempotency key).
 */
export async function runConfirmationRetries(limit = 200): Promise<{ sent: number; failed: number }> {
  const trialDays = siteConfig.premium.trialDays;
  const [d1, d2] = CONFIRM_RESEND_DAYS;
  const rows = await sql<{ id: number; email: string; confirm_token: string; paddle_subscription_id: string; manage_token: string; billing_status: BillingStatus; trial_ends_at: Date | null; plan_interval: PlanInterval | null; send_day: ConfirmSendDay }[]>`
    with due as (
      select s.id,
             case when s.billing_status = 'trialing' and s.trial_ends_at is not null
                    and now() >= s.trial_ends_at - make_interval(days => ${trialDays - d2}) then 'day10'
                  when s.billing_status = 'trialing' and s.trial_ends_at is not null
                    and now() >= s.trial_ends_at - make_interval(days => ${trialDays - d1}) then 'day3'
                  else 'start' end as send_day,
             s.trial_ends_at - make_interval(days => ${trialDays}) as trial_start
      from subscribers s
      where s.confirm_token is not null and awaiting_confirmation(s)
        and s.paddle_subscription_id is not null and s.billing_status = any(${LIVE_STATUSES})
        and not exists (select 1 from billing_flags f where f.subscription_id = s.paddle_subscription_id and f.kind = 'trial_unconfirmed' and f.cancel_done_at is not null)
    ), picked as (
      select s.id, d.send_day from subscribers s join due d on d.id = s.id
      where (s.confirm_sent_at is null or s.confirm_claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES}))
         -- A reminder day reached since the last send (and no send still in flight).
         or (s.confirm_claimed_at is null and d.send_day = 'day3' and s.confirm_sent_at < d.trial_start + make_interval(days => ${d1}))
         or (s.confirm_claimed_at is null and d.send_day = 'day10' and s.confirm_sent_at < d.trial_start + make_interval(days => ${d2}))
      order by s.id limit ${limit}
      for update of s skip locked
    )
    update subscribers s set confirm_sent_at = now(), confirm_claimed_at = now()
    from picked where s.id = picked.id
    returning s.id::int as id, s.email, s.confirm_token, s.paddle_subscription_id, s.manage_token, s.billing_status, s.trial_ends_at, s.plan_interval, picked.send_day`;
  let sent = 0, failed = 0;
  for (const [i, r] of rows.entries()) {
    await spaced(i);
    const res = await sendPaidConfirmation({
      subscriberId: r.id, email: r.email, confirmToken: r.confirm_token, subscriptionId: r.paddle_subscription_id, manageToken: r.manage_token,
      trialEndsAt: welcomeTrialEnd(r.billing_status, r.trial_ends_at), planInterval: r.plan_interval, sendDay: r.send_day,
    });
    if (res.ok) {
      sent++;
      await confirmationSent(r.id);
    } else {
      failed++;
      await confirmationNotSent(r.id);
    }
  }
  return { sent, failed };
}

// ── Trial ending ─────────────────────────────────────────────

/** How long before the first payment the reminder goes out (the job runs daily). */
const REMINDER_DAYS_BEFORE = 3;

/**
 * Daily job: the reminder before a trial's first payment, once per trial. Also
 * to addresses that unsubscribed, because it is about a payment. Not to one
 * still awaiting confirmation: that trial is canceled before it can charge.
 */
export async function runTrialReminders(limit = 500): Promise<{ sent: number; failed: number }> {
  const rows = await sql<{ id: number; email: string; manage_token: string; trial_ends_at: Date; plan_interval: PlanInterval | null }[]>`
    update subscribers set trial_reminder_sent_at = now(), trial_reminder_claimed_at = now()
    where id in (
      select id from subscribers
      where billing_status = 'trialing' and cancel_at is null and not awaiting_confirmation(subscribers)
        and (trial_reminder_sent_at is null or trial_reminder_claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES}))
        and trial_ends_at > now() and trial_ends_at <= now() + make_interval(days => ${REMINDER_DAYS_BEFORE})
      order by trial_ends_at limit ${limit}
    ) and (trial_reminder_sent_at is null or trial_reminder_claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES}))
    returning id::int as id, email, manage_token, trial_ends_at, plan_interval`;
  let sent = 0, failed = 0;
  for (const [i, r] of rows.entries()) {
    await spaced(i);
    const chargeDate = new Date(r.trial_ends_at).toISOString();
    const res = await sendEmail({
      to: r.email,
      ...trialReminderEmail({ plan: planDescription(r.plan_interval), price: planPrice(r.plan_interval), chargeDate, accountUrl: accountUrl(r.manage_token) }),
      idempotencyKey: `trial-reminder:${r.id}:${chargeDate}`,
    });
    if (res.ok) {
      sent++;
      await sql`update subscribers set trial_reminder_claimed_at = null where id = ${r.id}`;
    } else {
      failed++;
      await sql`update subscribers set trial_reminder_sent_at = null, trial_reminder_claimed_at = null where id = ${r.id}`;
    }
  }
  return { sent, failed };
}

// ── Unsubscribed, but the plan still runs ────────────────────

/**
 * After a one-click unsubscribe: if a payment is still ahead, one email
 * saying that unsubscribing stopped the emails, not the plan, with the link
 * to cancel. The key makes it once per unsubscribe.
 */
export async function sendPlanStillActiveNotice(subscriberId: number): Promise<SendResult | null> {
  const [s] = await sql<(PlanState & { email: string; manage_token: string; unsubscribed_at: Date | null })[]>`
    select email, manage_token, unsubscribed_at, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at
    from subscribers where id = ${subscriberId}`;
  const renewal = s ? planRenewal(s) : null;
  if (!s || !renewal?.chargesAhead) return null;
  return sendEmail({
    to: s.email,
    ...planStillActiveEmail({ renewal: renewal.sentence, accountUrl: accountUrl(s.manage_token) }),
    idempotencyKey: `unsubscribed-plan:${subscriberId}:${s.unsubscribed_at ? new Date(s.unsubscribed_at).toISOString() : "now"}`,
  });
}

// ── Early-access list ────────────────────────────────────────

export type WaitlistNoticeResult = { ok: boolean; sent: number; failed: number; remaining: number; message: string };

/**
 * Admin button: the one "alerts are open" email to confirmed early-access
 * members who never had a plan (it offers the free trial). At most `limit` per
 * click, to stay within the website's time limit.
 */
export async function notifyWaitlist(limit = 300): Promise<WaitlistNoticeResult> {
  if (!BILLING_LIVE) return { ok: false, sent: 0, failed: 0, remaining: 0, message: "Paid alerts aren't switched on yet (Paddle settings), so this email would not be true." };
  const live = LIVE_STATUSES as string[];
  const rows = await sql<{ id: number; email: string; unsubscribe_token: string }[]>`
    update subscribers set waitlist_notified_at = now()
    where id in (
      select id from subscribers
      where premium_waitlist and status = 'confirmed' and waitlist_notified_at is null and billing_status <> all(${live})
        -- The email offers the free trial: not to an address that has had a plan (see hadTrialBefore).
        and not had_plan(subscribers)
      order by id limit ${limit}
    ) and waitlist_notified_at is null
    returning id::int as id, email, unsubscribe_token`;
  let sent = 0, failed = 0;
  const trialUrl = absoluteUrl("/pricing/trial?utm_source=early-access&utm_medium=email");
  // An address that had a plan before its row was deleted keeps a trial marker, and another form
  // of the same address (name+x@, Gmail dots) may have had a plan: no trial offer (one per person;
  // it stays marked as notified, so it isn't picked again).
  const elsewhere = await trialUsedElsewhereIds(rows);
  const toSend = rows.filter((r) => !elsewhere.has(r.id));
  for (let i = 0; i < toSend.length; i += 100) {
    const chunk = toSend.slice(i, i + 100);
    const msgs: OutgoingEmail[] = chunk.map((r) => ({
      to: r.email,
      ...alertsOpenEmail({ trialUrl, unsubscribeUrl: absoluteUrl(`/alerts/unsubscribe?token=${r.unsubscribe_token}`) }),
      headers: unsubscribeHeaders(r.unsubscribe_token),
      idempotencyKey: `alerts-open:${r.id}`,
    }));
    const res = await sendBatch(msgs, () => batchKey("alerts-open", chunk.map((r) => `alerts-open:${r.id}`)));
    sent += res.sent;
    failed += res.failed;
    // Not sent: give those rows back so the next click tries again.
    const notSent = chunk.filter((_, j) => !res.delivered[j]).map((r) => r.id);
    if (notSent.length) await sql`update subscribers set waitlist_notified_at = null where id = any(${notSent})`;
  }
  const [{ remaining }] = await sql<{ remaining: number }[]>`
    select count(*)::int as remaining from subscribers
    where premium_waitlist and status = 'confirmed' and waitlist_notified_at is null and billing_status <> all(${live})
      and not had_plan(subscribers)`;
  const message = rows.length === 0
    ? "Nobody left to email: every confirmed early-access member has had this email."
    : `Sent ${sent}${failed ? `, ${failed} failed (they stay on the list for the next try)` : ""}. ${remaining ? `${remaining} still to send: click again.` : "Everyone has been emailed."}`;
  return { ok: failed === 0, sent, failed, remaining, message };
}

// ── Daily job ────────────────────────────────────────────────

export type PlanEmailsResult = { welcome: { sent: number; failed: number }; confirmations: { sent: number; failed: number }; trialReminders: { sent: number; failed: number } } | { skipped: string };

/** Run by the daily job (runDailyJob) right after the billing safety checks: welcome retries, confirmation retries and trial reminders. */
export async function runPlanEmails(): Promise<PlanEmailsResult> {
  if (!isEmailConfigured()) return { skipped: "Email sending is not configured (RESEND_API_KEY missing)." };
  const welcome = await runWelcomeRetries();
  const confirmations = await runConfirmationRetries();
  const trialReminders = await runTrialReminders();
  return { welcome, confirmations, trialReminders };
}
