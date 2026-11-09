/**
 * Paid email alerts: starting a checkout and applying Paddle webhook events
 * to subscribers. Server only.
 *
 * Flow:
 *  1. startCheckout() stores (or finds) the subscriber and returns an opaque
 *     reference, which the browser passes to Paddle Checkout as customData.
 *  2. Paddle creates the subscription and sends webhooks; handlePaddleEvent()
 *     finds the subscriber through that reference (Paddle copies a checkout's
 *     customData onto the subscription) and mirrors the subscription's status.
 */
import { randomBytes } from "node:crypto";
import { recordEvent } from "@/lib/analytics";
import { PADDLE_PRICE_MONTHLY, PADDLE_PRICE_QUARTERLY } from "@/lib/billing/live";
import { getSubscription, isPaddleApiConfigured, type PaddleSubscription } from "@/lib/billing/paddle";
import { sql } from "@/lib/db";
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
  | { ok: true; ref: string; email: string }
  | { ok: true; alreadySubscribed: true; email: string; manageToken: string }
  | { ok: false; error: string };

/**
 * Prepares a checkout. A new address gets a pending subscriber row (no
 * confirmation email: paying through Paddle confirms it) and its first saved
 * search. An existing address is NOT changed here, because anyone can type
 * any address: its search waits in paddle_checkouts until Paddle reports a
 * subscription for this reference.
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

  const [created] = await sql<{ id: number }[]>`
    insert into subscribers (email, status, wants_alerts, frequency, preferences, unsubscribe_token, source, attribution)
    values (${email}, 'pending', true, 'daily', '{}'::jsonb, ${newToken()}, ${opts.source ?? null}, ${attribution ? sql.json(attribution) : null})
    on conflict (email) do nothing
    returning id::int as id`;

  if (created) {
    await addSavedSearch(created.id, opts.search ?? "");
    await sql`
      insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor)
      values (${ref}, ${created.id}, ${opts.plan}, ${opts.search}, true, ${opts.visitor ?? null})`;
    return { ok: true, ref, email };
  }

  const [existing] = await sql<{ id: number; billing_status: BillingStatus; manage_token: string }[]>`
    select id::int as id, billing_status, manage_token from subscribers where email = ${email}`;
  if (!existing) return { ok: false, error: "Something went wrong on our side. Please try again in a minute." };
  // One subscription per address: send the existing subscriber to their account instead.
  if (LIVE_STATUSES.includes(existing.billing_status)) {
    return { ok: true, alreadySubscribed: true, email, manageToken: existing.manage_token };
  }
  // First-touch attribution only, as in the early-access sign-up.
  if (attribution) await sql`update subscribers set attribution = coalesce(attribution, ${sql.json(attribution)}) where id = ${existing.id}`;
  await sql`
    insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor)
    values (${ref}, ${existing.id}, ${opts.plan}, ${opts.search}, false, ${opts.visitor ?? null})`;
  return { ok: true, ref, email };
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

/** What a status change means for emails and analytics. Pure, so it is unit-tested. */
export function transitionEffects(prev: { subscriptionId: string | null; status: BillingStatus; welcomeSent: boolean }, next: { subscriptionId: string; status: BillingStatus }) {
  const sameSub = prev.subscriptionId === next.subscriptionId;
  return {
    /** A new subscription in trial (re-sent snapshots of the same trial don't count twice). */
    trialStarted: next.status === "trialing" && !(sameSub && prev.status === "trialing"),
    canceled: next.status === "canceled" && !(sameSub && prev.status === "canceled"),
    /** The welcome email with the account link goes out once, when alerts first start. */
    sendWelcome: ALERT_STATUSES.includes(next.status) && !prev.welcomeSent,
  };
}

export type WelcomeInfo = { email: string; manageToken: string; unsubscribeToken: string; trialEndsAt: string | null; planInterval: PlanInterval | null };
export type HandleResult = { outcome: "duplicate" | "ignored" | "unmatched" | "applied" | "stale"; welcome?: WelcomeInfo };

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created", "subscription.updated", "subscription.activated", "subscription.trialing",
  "subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.canceled",
]);

/**
 * Applies one verified webhook event. Each event_id is processed once: it is
 * recorded first, and the record is removed again if processing fails, so
 * Paddle's retry can run it.
 */
export async function handlePaddleEvent(event: PaddleEvent): Promise<HandleResult> {
  if (!event?.event_id || typeof event.event_type !== "string") return { outcome: "ignored" };
  const relevant = SUBSCRIPTION_EVENTS.has(event.event_type) || event.event_type === "transaction.completed";
  const occurredAt = isoOrNull(event.occurred_at) ?? new Date().toISOString();
  const fresh = await sql`
    insert into paddle_events (event_id, event_type, occurred_at) values (${event.event_id.slice(0, 100)}, ${event.event_type.slice(0, 60)}, ${occurredAt})
    on conflict (event_id) do nothing returning event_id`;
  if (fresh.length === 0) return { outcome: "duplicate" };
  if (!relevant) return { outcome: "ignored" };
  try {
    if (event.event_type === "transaction.completed") return await applyTransaction(event.data, occurredAt);
    return await applySubscription(event.data as unknown as PaddleSubscription, occurredAt);
  } catch (e) {
    await sql`delete from paddle_events where event_id = ${event.event_id.slice(0, 100)}`.catch(() => {});
    throw e;
  }
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
 */
async function applyTransaction(data: Record<string, unknown>, occurredAt: string): Promise<HandleResult> {
  const subId = typeof data.subscription_id === "string" ? data.subscription_id : null;
  if (!subId) return { outcome: "ignored" };
  const [known] = await sql`select 1 from subscribers where paddle_subscription_id = ${subId}`;
  if (known || !isPaddleApiConfigured()) return { outcome: "ignored" };
  const sub = await getSubscription(subId);
  // The fetched snapshot is current, so it may stand in for any event up to now.
  return applySubscription({ ...sub, custom_data: sub.custom_data ?? (data.custom_data as Record<string, unknown> | null) }, occurredAt);
}

async function findSubscriber(sub: PaddleSubscription) {
  const ref = refOf(sub.custom_data);
  if (ref) {
    const [c] = await sql<{ subscriber_id: number; plan: CheckoutPlan; search: string | null; visitor: string | null }[]>`
      select subscriber_id::int as subscriber_id, plan, search, visitor from paddle_checkouts where ref = ${ref}`;
    if (c) return { subscriberId: c.subscriber_id, checkout: { ref, ...c } };
  }
  const [bySub] = await sql<{ id: number }[]>`select id::int as id from subscribers where paddle_subscription_id = ${sub.id}`;
  if (bySub) return { subscriberId: bySub.id, checkout: null };
  if (typeof sub.customer_id === "string" && sub.customer_id) {
    const [byCustomer] = await sql<{ id: number }[]>`
      select id::int as id from subscribers where paddle_customer_id = ${sub.customer_id} order by id desc limit 1`;
    if (byCustomer) return { subscriberId: byCustomer.id, checkout: null };
  }
  return null;
}

async function applySubscription(sub: PaddleSubscription, occurredAt: string): Promise<HandleResult> {
  if (typeof sub?.id !== "string" || !/^sub_[a-z\d]{26}$/.test(sub.id)) return { outcome: "ignored" };
  const target = await findSubscriber(sub);
  if (!target) {
    // E.g. a simulated event, or a subscription created outside this site.
    console.warn(`paddle webhook: no subscriber for ${sub.id}`);
    return { outcome: "unmatched" };
  }
  const b = billingFromSubscription(sub);
  if (b.status === "none") return { outcome: "ignored" };
  const live = LIVE_STATUSES.includes(b.status);
  const alerts = ALERT_STATUSES.includes(b.status);
  const fallbackInterval: PlanInterval | null = target.checkout ? (target.checkout.plan === "quarterly" ? "quarter" : "month") : null;

  // One statement: lock the row, keep its previous values, apply the change.
  // Skipped when the event is older than the last one applied for this
  // subscription, or when it would overwrite a different subscription that
  // is still running with a canceled one.
  const [row] = await sql<{
    prev_sub: string | null; prev_status: BillingStatus; prev_welcome: boolean;
    email: string; manage_token: string; unsubscribe_token: string; attribution: Record<string, string> | null;
    trial_ends_at: Date | null; plan_interval: PlanInterval | null;
  }[]>`
    with prev as (
      select id, paddle_subscription_id, billing_status, welcome_sent_at is not null as welcome
      from subscribers where id = ${target.subscriberId} for update
    )
    update subscribers s set
      paddle_customer_id = coalesce(${sub.customer_id ?? null}, s.paddle_customer_id),
      paddle_subscription_id = ${sub.id},
      billing_status = ${b.status},
      plan = ${alerts ? "premium" : "free"},
      plan_interval = coalesce(${b.planInterval ?? fallbackInterval}, s.plan_interval),
      trial_ends_at = coalesce(${b.trialEndsAt}, s.trial_ends_at),
      current_period_end = ${b.currentPeriodEnd},
      canceled_at = ${b.canceledAt},
      cancel_at = ${b.cancelAt},
      billing_event_at = ${occurredAt},
      -- A newly linked, running subscription confirms the address (the person paid with it at checkout).
      status = case when ${live} and s.paddle_subscription_id is distinct from ${sub.id} then 'confirmed' else s.status end,
      confirmed_at = case when ${live} and s.paddle_subscription_id is distinct from ${sub.id} then coalesce(s.confirmed_at, now()) else s.confirmed_at end,
      unsubscribed_at = case when ${live} and s.paddle_subscription_id is distinct from ${sub.id} then null else s.unsubscribed_at end,
      confirm_token = case when ${live} and s.paddle_subscription_id is distinct from ${sub.id} then null else s.confirm_token end,
      wants_alerts = case when ${live} then true else s.wants_alerts end,
      welcome_sent_at = case when ${alerts} then coalesce(s.welcome_sent_at, now()) else s.welcome_sent_at end
    from prev
    where s.id = prev.id
      and (prev.paddle_subscription_id is distinct from ${sub.id} or s.billing_event_at is null or s.billing_event_at <= ${occurredAt})
      and (prev.paddle_subscription_id is null or prev.paddle_subscription_id = ${sub.id} or ${live}
           or prev.billing_status not in ('trialing', 'active', 'past_due', 'paused'))
    returning prev.paddle_subscription_id as prev_sub, prev.billing_status as prev_status, prev.welcome as prev_welcome,
              s.email, s.manage_token, s.unsubscribe_token, s.attribution, s.trial_ends_at, s.plan_interval`;
  if (!row) return { outcome: "stale" };

  if (target.checkout) {
    await sql`update paddle_checkouts set subscription_id = ${sub.id} where ref = ${target.checkout.ref}`;
    // The search picked at checkout (already saved for brand-new subscribers).
    if (live && row.prev_sub !== sub.id) {
      await addSavedSearch(target.subscriberId, target.checkout.search ?? "").catch((e) => console.warn("paddle webhook: saved search not added", (e as Error).message));
    }
  }

  const fx = transitionEffects({ subscriptionId: row.prev_sub, status: row.prev_status, welcomeSent: row.prev_welcome }, { subscriptionId: sub.id, status: b.status });
  const props = { plan: row.plan_interval, ...(row.attribution ? { campaign: row.attribution } : {}) };
  if (fx.trialStarted) await recordEvent({ type: "trial_started", visitor: target.checkout?.visitor ?? null, props });
  if (fx.canceled) await recordEvent({ type: "subscription_canceled", props });

  return {
    outcome: "applied",
    welcome: fx.sendWelcome
      ? { email: row.email, manageToken: row.manage_token, unsubscribeToken: row.unsubscribe_token, trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null, planInterval: row.plan_interval }
      : undefined,
  };
}

/** Called when sending the welcome email failed, so a later event can try again. */
export async function welcomeNotSent(email: string): Promise<void> {
  await sql`update subscribers set welcome_sent_at = null where email = ${email}`;
}
