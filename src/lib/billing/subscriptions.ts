/**
 * Paid email alerts: starting a checkout and applying Paddle webhook events
 * to subscribers. Server only.
 *
 * Flow:
 *  1. startCheckout() stores (or finds) the subscriber and returns an opaque
 *     reference, which the browser passes to Paddle Checkout as customData.
 *     One free trial per person: an address that has had a plan before
 *     (hadTrialBefore) gets a Paddle transaction instead, for the same plan
 *     without the trial and with the reference in its custom_data, and the
 *     browser opens Paddle Checkout for that transaction.
 *  2. Paddle creates the subscription and sends webhooks; handlePaddleEvent()
 *     finds the subscriber through that reference (Paddle copies a checkout's
 *     customData onto the subscription) and mirrors the subscription's status.
 *  3. Only an address created by that checkout (or by an earlier, unfinished
 *     checkout, untouched since) counts as confirmed by paying (the payer
 *     typed it). An address that already existed keeps its email
 *     status (pending or unsubscribed) until its owner clicks the link we
 *     email to it, because anyone can type anyone's address at checkout.
 */
import { randomBytes } from "node:crypto";
import { recordEvent } from "@/lib/analytics";
import { PADDLE_PRICE_MONTHLY, PADDLE_PRICE_QUARTERLY } from "@/lib/billing/live";
import { createNoTrialTransaction, getSubscription, isPaddleApiConfigured, type PaddleSubscription } from "@/lib/billing/paddle";
import { sql, transaction, type Db, type Tx } from "@/lib/db";
import { addSavedSearch } from "@/lib/saved-searches";
import { normalizeEmail } from "@/lib/subscribers";

export type CheckoutPlan = "monthly" | "quarterly";
export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "paused" | "canceled";
export type PlanInterval = "month" | "quarter";

/** Statuses that receive alerts. */
export const ALERT_STATUSES: BillingStatus[] = ["trialing", "active"];
/** Statuses where a Paddle subscription still exists (not yet canceled). */
export const LIVE_STATUSES: BillingStatus[] = ["trialing", "active", "past_due", "paused"];

const newToken = () => randomBytes(24).toString("base64url");

// ── Checkout ─────────────────────────────────────────────────

export type StartCheckoutResult =
  /** Checkout with the catalog price and its free trial. */
  | { ok: true; ref: string; email: string; trial: true }
  /** Returning customer: Paddle Checkout opens this transaction (the plan, charged straight away). */
  | { ok: true; ref: string; email: string; trial: false; transactionId: string }
  | { ok: true; alreadySubscribed: true; email: string; manageToken: string }
  /** noTrial: the address has had a trial before (the form keeps the trial terms off). */
  | { ok: false; error: string; noTrial?: boolean };

/** Shown when a returning customer's checkout (no trial) can't be prepared. */
export const CHECKOUT_UNAVAILABLE = "We couldn't open checkout. Please try again or email us.";

/** The subscriber fields that show whether an address has had a plan before. */
export type PlanHistory = {
  paddle_subscription_id: string | null;
  billing_status: BillingStatus;
  trial_ends_at: Date | string | null;
  canceled_at: Date | string | null;
};

/**
 * One free trial per person: has this address had a Paddle subscription
 * before? Every subscription sold through this site started with a trial
 * unless the address had had one already, so any earlier subscription counts,
 * including a trial canceled before it ended. A row only ever gains these
 * fields from Paddle's webhooks, and the webhook never clears
 * paddle_subscription_id or billing_status, so any one of them is enough.
 * Limit: a canceled plan's row is deleted 30 days after the cancellation
 * (privacy policy, purgeStaleSubscribers); after that the address counts as
 * new again. Pure, so it is unit-tested.
 */
export function hadTrialBefore(h: PlanHistory): boolean {
  return Boolean(h.paddle_subscription_id) || (h.billing_status ?? "none") !== "none" || h.trial_ends_at != null || h.canceled_at != null;
}

const priceIdFor = (plan: CheckoutPlan) => (plan === "quarterly" ? PADDLE_PRICE_QUARTERLY : PADDLE_PRICE_MONTHLY);

/**
 * Prepares a checkout. A new address gets a pending subscriber row (no
 * confirmation email: paying through Paddle confirms it) and its first saved
 * search. An existing address is NOT changed here, because anyone can type
 * any address: its search waits in paddle_checkouts until Paddle reports a
 * subscription for this reference, and even then its email status only
 * changes once the owner confirms (see applySubscription).
 */
export async function startCheckout(opts: {
  email: string;
  plan: CheckoutPlan;
  search: string | null;
  source?: string;
  attribution?: Record<string, string> | null;
  visitor?: string | null;
}): Promise<StartCheckoutResult> {
  const email = normalizeEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const ref = newToken();
  const attribution = opts.attribution ?? null;

  // A new address: the subscriber row, its first search and the checkout
  // record are written together or not at all (a half-written row would
  // otherwise be treated as an existing address on the next try).
  const created = await transaction(async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      insert into subscribers (email, status, wants_alerts, frequency, preferences, unsubscribe_token, source, attribution)
      values (${email}, 'pending', true, 'daily', '{}'::jsonb, ${newToken()}, ${opts.source ?? null}, ${attribution ? tx.json(attribution) : null})
      on conflict (email) do nothing
      returning id::int as id`;
    if (!row) return false;
    await addSavedSearch(row.id, opts.search ?? "", tx);
    await tx`
      insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor)
      values (${ref}, ${row.id}, ${opts.plan}, ${opts.search}, true, ${opts.visitor ?? null})`;
    return true;
  });
  // A brand-new address has had no plan here: the catalog price, with its trial.
  if (created) return { ok: true, ref, email, trial: true };

  // checkout_created: the row was created by an earlier checkout that was never
  // finished, and nobody has touched it since (no confirmation, no sign-up or
  // confirmation link, no subscription). Retrying the checkout is the same
  // payer typing the same new address again, so paying confirms it as well;
  // otherwise the row would stay pending after payment and alerts never start.
  const [existing] = await sql<(PlanHistory & { id: number; manage_token: string; checkout_created: boolean })[]>`
    select s.id::int as id, s.billing_status, s.manage_token, s.paddle_subscription_id, s.trial_ends_at, s.canceled_at,
           (s.status = 'pending' and s.confirmed_at is null and s.confirm_token is null and s.paddle_subscription_id is null
            and exists (select 1 from paddle_checkouts c where c.subscriber_id = s.id and c.new_subscriber)) as checkout_created
    from subscribers s where s.email = ${email}`;
  if (!existing) return { ok: false, error: "Something went wrong on our side. Please try again in a minute." };
  // One subscription per address: send the existing subscriber to their account instead.
  if (LIVE_STATUSES.includes(existing.billing_status)) {
    return { ok: true, alreadySubscribed: true, email, manageToken: existing.manage_token };
  }

  // One free trial per person: an address that has had a plan before pays
  // through a transaction for the same plan without the trial. If that
  // transaction can't be created (no API key, Paddle refuses or is down),
  // stop here: never fall back to the catalog price, which has the trial.
  const returning = hadTrialBefore(existing);
  let transactionId: string | null = null;
  if (returning) {
    try {
      if (!isPaddleApiConfigured()) throw new Error("PADDLE_API_KEY is not set");
      transactionId = await createNoTrialTransaction(priceIdFor(opts.plan), { ref });
    } catch (e) {
      console.error("no-trial checkout failed", (e as Error).message);
      return { ok: false, error: CHECKOUT_UNAVAILABLE, noTrial: true };
    }
  }

  // First-touch attribution only, as in the early-access sign-up.
  if (attribution) await sql`update subscribers set attribution = coalesce(attribution, ${sql.json(attribution)}) where id = ${existing.id}`;
  await sql`
    insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor)
    values (${ref}, ${existing.id}, ${opts.plan}, ${opts.search}, ${existing.checkout_created}, ${opts.visitor ?? null})`;
  return transactionId ? { ok: true, ref, email, trial: false, transactionId } : { ok: true, ref, email, trial: true };
}

/**
 * After the browser sees "checkout completed": the account link, but only
 * when this checkout created the subscriber row and the webhook has already
 * linked its subscription. Everyone else gets the link by email.
 */
export async function checkoutAccountToken(ref: string): Promise<{ linked: boolean; manageToken: string | null }> {
  if (!/^[\w-]{20,64}$/.test(ref)) return { linked: false, manageToken: null };
  const [row] = await sql<{ new_subscriber: boolean; linked: boolean; manage_token: string }[]>`
    select c.new_subscriber, (c.subscription_id is not null and s.paddle_subscription_id = c.subscription_id) as linked, s.manage_token
    from paddle_checkouts c join subscribers s on s.id = c.subscriber_id
    where c.ref = ${ref} and c.created_at > now() - interval '2 hours'`;
  if (!row) return { linked: false, manageToken: null };
  return { linked: row.linked, manageToken: row.linked && row.new_subscriber ? row.manage_token : null };
}


// ── Webhook state ────────────────────────────────────────────

export type PaddleEvent = { event_id: string; event_type: string; occurred_at: string; data: Record<string, unknown> };

/** The billing fields a subscription snapshot maps to. Pure, so it is unit-tested. */
export type BillingFields = {
  status: BillingStatus;
  planInterval: PlanInterval | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  cancelAt: string | null;
};

const KNOWN_STATUSES: BillingStatus[] = ["trialing", "active", "past_due", "paused", "canceled"];

export function billingFromSubscription(
  sub: PaddleSubscription,
  prices: { monthly: string; quarterly: string } = { monthly: PADDLE_PRICE_MONTHLY, quarterly: PADDLE_PRICE_QUARTERLY },
): BillingFields {
  const status = (KNOWN_STATUSES as string[]).includes(sub.status) ? (sub.status as BillingStatus) : "none";
  const priceIds = (sub.items ?? []).map((i) => i.price?.id).filter(Boolean);
  let planInterval: PlanInterval | null = null;
  if (prices.quarterly && priceIds.includes(prices.quarterly)) planInterval = "quarter";
  else if (prices.monthly && priceIds.includes(prices.monthly)) planInterval = "month";
  else if (sub.billing_cycle?.interval === "month") planInterval = sub.billing_cycle.frequency === 3 ? "quarter" : sub.billing_cycle.frequency === 1 ? "month" : null;
  const trialEnd = (sub.items ?? []).map((i) => i.trial_dates?.ends_at).find(Boolean) ?? null;
  return {
    status,
    planInterval,
    trialEndsAt: trialEnd ?? (status === "trialing" ? sub.current_billing_period?.ends_at ?? null : null),
    currentPeriodEnd: sub.current_billing_period?.ends_at ?? sub.next_billed_at ?? null,
    canceledAt: sub.canceled_at ?? null,
    cancelAt: sub.scheduled_change?.action === "cancel" ? sub.scheduled_change.effective_at : null,
  };
}

/**
 * What a status change means for emails and analytics. Pure, so it is unit-tested.
 * next.confirmed: the address is confirmed after this change (only confirmed
 * addresses get the welcome email; the others get a confirmation link first).
 */
export function transitionEffects(
  prev: { subscriptionId: string | null; status: BillingStatus; welcomeSent: boolean },
  next: { subscriptionId: string; status: BillingStatus; confirmed: boolean },
) {
  const sameSub = prev.subscriptionId === next.subscriptionId;
  return {
    /** A new subscription in trial (re-sent snapshots of the same trial don't count twice). */
    trialStarted: next.status === "trialing" && !(sameSub && prev.status === "trialing"),
    canceled: next.status === "canceled" && !(sameSub && prev.status === "canceled"),
    /** The welcome email with the account link goes out once, when alerts first start at a confirmed address. */
    sendWelcome: ALERT_STATUSES.includes(next.status) && next.confirmed && !prev.welcomeSent,
    /** A running subscription newly linked to an address that isn't confirmed: ask its owner to confirm. */
    askConfirm: LIVE_STATUSES.includes(next.status) && !sameSub && !next.confirmed,
  };
}

/**
 * The trial end date the welcome email mentions: only while the subscription
 * is in its trial. A plan that started without one (a returning customer)
 * arrives as active, and its welcome must not talk about a trial.
 */
export function welcomeTrialEnd(status: BillingStatus, trialEndsAt: Date | string | null): string | null {
  return status === "trialing" && trialEndsAt ? new Date(trialEndsAt).toISOString() : null;
}

export type WelcomeInfo = { subscriberId: number; email: string; manageToken: string; unsubscribeToken: string; trialEndsAt: string | null; planInterval: PlanInterval | null };
export type ConfirmInfo = { subscriberId: number; email: string; confirmToken: string; subscriptionId: string };
export type HandleResult = {
  outcome: "duplicate" | "ignored" | "unmatched" | "applied" | "stale";
  welcome?: WelcomeInfo;
  /** An existing address got a subscription it hasn't confirmed: email it a confirmation link. */
  confirm?: ConfirmInfo;
};

/** Analytics recorded after the transaction commits. */
type Effects = { trialStarted: boolean; canceled: boolean; visitor: string | null; props: Record<string, unknown> };

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created", "subscription.updated", "subscription.activated", "subscription.trialing",
  "subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.canceled",
]);

/**
 * Applies one verified webhook event, once per event_id.
 *
 * The event_id record and the subscriber change are written in ONE
 * transaction: they commit together or not at all. If the function is killed
 * half-way, Postgres rolls both back and Paddle's retry applies the event
 * again. A second delivery arriving while the first is still running waits
 * for it (the event_id is the primary key) and is then seen as a duplicate.
 * Emails and analytics happen only after the commit.
 */
export async function handlePaddleEvent(event: PaddleEvent): Promise<HandleResult> {
  if (!event?.event_id || typeof event.event_type !== "string") return { outcome: "ignored" };
  const eventId = event.event_id.slice(0, 100);
  const occurredAt = isoOrNull(event.occurred_at) ?? new Date().toISOString();

  // The subscription snapshot to apply, if any. Fetching it from Paddle's API
  // (transaction.completed only) happens before the transaction, so no
  // transaction stays open while waiting for Paddle.
  let sub: PaddleSubscription | null = null;
  if (SUBSCRIPTION_EVENTS.has(event.event_type)) {
    sub = event.data as unknown as PaddleSubscription;
  } else if (event.event_type === "transaction.completed") {
    const [seen] = await sql`select 1 from paddle_events where event_id = ${eventId}`;
    if (seen) return { outcome: "duplicate" };
    sub = await subscriptionForTransaction(event.data);
  }

  const res = await transaction(async (tx): Promise<{ result: HandleResult; effects?: Effects }> => {
    const fresh = await tx`
      insert into paddle_events (event_id, event_type, occurred_at) values (${eventId}, ${event.event_type.slice(0, 60)}, ${occurredAt})
      on conflict (event_id) do nothing returning event_id`;
    if (fresh.length === 0) return { result: { outcome: "duplicate" } };
    if (!sub) return { result: { outcome: "ignored" } };
    return applySubscription(tx, sub, occurredAt);
  });

  // Committed. Analytics failures are only logged: the event is applied.
  const fx = res.effects;
  if (fx?.trialStarted) await recordEvent({ type: "trial_started", visitor: fx.visitor, props: fx.props });
  if (fx?.canceled) await recordEvent({ type: "subscription_canceled", props: fx.props });
  return res.result;
}

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

function refOf(customData: unknown): string | null {
  const ref = (customData as { ref?: unknown } | null)?.ref;
  return typeof ref === "string" && /^[\w-]{20,64}$/.test(ref) ? ref : null;
}

/**
 * transaction.completed: the subscription events normally carry everything.
 * This only matters when no subscription event has linked the subscription
 * yet; then the subscription is fetched from the API (if a key is set).
 * Returns null when there is nothing to apply.
 */
async function subscriptionForTransaction(data: Record<string, unknown>): Promise<PaddleSubscription | null> {
  const subId = typeof data?.subscription_id === "string" ? data.subscription_id : null;
  if (!subId) return null;
  const [known] = await sql`select 1 from subscribers where paddle_subscription_id = ${subId}`;
  if (known || !isPaddleApiConfigured()) return null;
  const sub = await getSubscription(subId);
  // The fetched snapshot is current, so it may stand in for any event up to now.
  return { ...sub, custom_data: sub.custom_data ?? (data.custom_data as Record<string, unknown> | null) };
}

async function findSubscriber(db: Db, sub: PaddleSubscription) {
  const ref = refOf(sub.custom_data);
  if (ref) {
    const [c] = await db<{ subscriber_id: number; plan: CheckoutPlan; search: string | null; visitor: string | null; new_subscriber: boolean }[]>`
      select subscriber_id::int as subscriber_id, plan, search, visitor, new_subscriber from paddle_checkouts where ref = ${ref}`;
    if (c) return { subscriberId: c.subscriber_id, checkout: { ref, ...c } };
  }
  const [bySub] = await db<{ id: number }[]>`select id::int as id from subscribers where paddle_subscription_id = ${sub.id}`;
  if (bySub) return { subscriberId: bySub.id, checkout: null };
  if (typeof sub.customer_id === "string" && sub.customer_id) {
    const [byCustomer] = await db<{ id: number }[]>`
      select id::int as id from subscribers where paddle_customer_id = ${sub.customer_id} order by id desc limit 1`;
    if (byCustomer) return { subscriberId: byCustomer.id, checkout: null };
  }
  return null;
}

async function applySubscription(tx: Tx, sub: PaddleSubscription, occurredAt: string): Promise<{ result: HandleResult; effects?: Effects }> {
  if (typeof sub?.id !== "string" || !/^sub_[a-z\d]{26}$/.test(sub.id)) return { result: { outcome: "ignored" } };
  const target = await findSubscriber(tx, sub);
  if (!target) {
    // E.g. a simulated event, or a subscription created outside this site.
    console.warn(`paddle webhook: no subscriber for ${sub.id}`);
    return { result: { outcome: "unmatched" } };
  }
  const b = billingFromSubscription(sub);
  if (b.status === "none") return { result: { outcome: "ignored" } };
  const live = LIVE_STATUSES.includes(b.status);
  const alerts = ALERT_STATUSES.includes(b.status);
  const fallbackInterval: PlanInterval | null = target.checkout ? (target.checkout.plan === "quarterly" ? "quarter" : "month") : null;
  // Paying confirms the address only when this checkout created it (the payer typed a new address).
  const paymentConfirms = live && Boolean(target.checkout?.new_subscriber);

  // One statement: lock the row, keep its previous values, apply the change.
  // Skipped when the event is older than the last one applied for this
  // subscription, or when it would overwrite a different subscription that
  // is still running with a canceled one.
  const [row] = await tx<{
    prev_sub: string | null; prev_status: BillingStatus; prev_welcome: boolean;
    email: string; status: string; manage_token: string; unsubscribe_token: string; confirm_token: string | null;
    attribution: Record<string, string> | null; trial_ends_at: Date | null; plan_interval: PlanInterval | null;
  }[]>`
    with prev as (
      select id, paddle_subscription_id, billing_status, welcome_sent_at is not null as welcome,
             -- A running subscription this row didn't have before.
             (${live}::boolean and paddle_subscription_id is distinct from ${sub.id}) as live_link,
             case when ${paymentConfirms}::boolean and paddle_subscription_id is distinct from ${sub.id} then 'confirmed' else status end as next_status
      from subscribers where id = ${target.subscriberId} for update
    )
    update subscribers s set
      paddle_customer_id = coalesce(${sub.customer_id ?? null}, s.paddle_customer_id),
      paddle_subscription_id = ${sub.id},
      billing_status = ${b.status},
      plan = ${alerts ? "premium" : "free"},
      plan_interval = coalesce(${b.planInterval ?? fallbackInterval}, s.plan_interval),
      -- The trial of THIS subscription: a different one (a returning customer's plan,
      -- which has no trial) must not inherit the date of an earlier trial.
      trial_ends_at = case when prev.paddle_subscription_id is distinct from ${sub.id} then ${b.trialEndsAt}::timestamptz
                           else coalesce(${b.trialEndsAt}::timestamptz, s.trial_ends_at) end,
      current_period_end = ${b.currentPeriodEnd},
      canceled_at = ${b.canceledAt},
      cancel_at = ${b.cancelAt},
      billing_event_at = ${occurredAt},
      -- A new address paid for by this checkout is confirmed (the payer typed it).
      -- An existing address keeps its status; a newly linked running subscription
      -- gets a confirmation link instead (sent after the commit).
      status = prev.next_status,
      confirmed_at = case when prev.next_status = 'confirmed' then coalesce(s.confirmed_at, now()) else s.confirmed_at end,
      unsubscribed_at = case when prev.next_status = 'confirmed' then null else s.unsubscribed_at end,
      confirm_token = case when prev.next_status = 'confirmed' then null
                           when prev.live_link then coalesce(s.confirm_token, ${newToken()})
                           else s.confirm_token end,
      -- Claimed here (with a lease, confirm_claimed_at), sent after the commit (see the webhook route).
      confirm_sent_at = case when prev.live_link and prev.next_status <> 'confirmed' then now() else s.confirm_sent_at end,
      confirm_claimed_at = case when prev.live_link and prev.next_status <> 'confirmed' then now() else s.confirm_claimed_at end,
      wants_alerts = case when ${live} then true else s.wants_alerts end,
      -- A different subscription (e.g. a returning customer's new trial) gets its own trial reminder.
      trial_reminder_sent_at = case when prev.paddle_subscription_id is distinct from ${sub.id} then null else s.trial_reminder_sent_at end,
      trial_reminder_claimed_at = case when prev.paddle_subscription_id is distinct from ${sub.id} then null else s.trial_reminder_claimed_at end,
      -- Claimed here, sent after the commit; reset if sending fails (welcomeNotSent). welcome_claimed_at
      -- is the lease: cleared once sent (welcomeSent), and the daily job picks up a claim older than 30 minutes.
      welcome_sent_at = case when ${alerts} and prev.next_status = 'confirmed' then coalesce(s.welcome_sent_at, now()) else s.welcome_sent_at end,
      welcome_claimed_at = case when ${alerts} and prev.next_status = 'confirmed' and s.welcome_sent_at is null then now() else s.welcome_claimed_at end
    from prev
    where s.id = prev.id
      and (prev.paddle_subscription_id is distinct from ${sub.id} or s.billing_event_at is null or s.billing_event_at <= ${occurredAt})
      and (prev.paddle_subscription_id is null or prev.paddle_subscription_id = ${sub.id} or ${live}
           or prev.billing_status not in ('trialing', 'active', 'past_due', 'paused'))
    returning prev.paddle_subscription_id as prev_sub, prev.billing_status as prev_status, prev.welcome as prev_welcome,
              s.email, s.status, s.manage_token, s.unsubscribe_token, s.confirm_token, s.attribution, s.trial_ends_at, s.plan_interval`;
  if (!row) return { result: { outcome: "stale" } };

  if (target.checkout) {
    await tx`update paddle_checkouts set subscription_id = ${sub.id} where ref = ${target.checkout.ref}`;
    // The search picked at checkout (already saved for brand-new subscribers).
    // In a savepoint: a failure here (e.g. the 5-search limit) must not undo the event.
    if (live && row.prev_sub !== sub.id) {
      const search = target.checkout.search ?? "";
      await tx.savepoint((sp) => addSavedSearch(target.subscriberId, search, sp))
        .catch((e: Error) => console.warn("paddle webhook: saved search not added", (e as Error).message));
    }
  }

  const confirmed = row.status === "confirmed";
  const fx = transitionEffects({ subscriptionId: row.prev_sub, status: row.prev_status, welcomeSent: row.prev_welcome }, { subscriptionId: sub.id, status: b.status, confirmed });
  const props = { plan: row.plan_interval, ...(row.attribution ? { campaign: row.attribution } : {}) };

  return {
    result: {
      outcome: "applied",
      welcome: fx.sendWelcome
        ? { subscriberId: target.subscriberId, email: row.email, manageToken: row.manage_token, unsubscribeToken: row.unsubscribe_token, trialEndsAt: welcomeTrialEnd(b.status, row.trial_ends_at), planInterval: row.plan_interval }
        : undefined,
      confirm: fx.askConfirm && row.confirm_token
        ? { subscriberId: target.subscriberId, email: row.email, confirmToken: row.confirm_token, subscriptionId: sub.id }
        : undefined,
    },
    effects: { trialStarted: fx.trialStarted, canceled: fx.canceled, visitor: target.checkout?.visitor ?? null, props },
  };
}

/** Called when sending the welcome email failed, so the daily job (or a later event) can try again. */
export async function welcomeNotSent(subscriberId: number): Promise<void> {
  await sql`update subscribers set welcome_sent_at = null, welcome_claimed_at = null where id = ${subscriberId}`;
}

/** Called once Resend accepted the welcome email: ends the claim's lease (see db/migrations/009_email_claim_leases.sql). */
export async function welcomeSent(subscriberId: number): Promise<void> {
  await sql`update subscribers set welcome_claimed_at = null where id = ${subscriberId}`;
}
