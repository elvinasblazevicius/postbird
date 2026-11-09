/**
 * Paid daily alerts: starting a checkout and applying Paddle webhook events
 * to subscribers. Server only.
 *
 * Flow:
 *  1. startCheckout() decides what the public form may do with an address:
 *      - a new address, or one that never had a plan, gets an opaque reference
 *        that the browser passes to Paddle Checkout as customData, for the
 *        catalog price with its free trial (trial_allowed on the checkout row);
 *      - an address that has or had a plan (or whose canonical form had one,
 *        or whose deletion left a trial marker, see trial-markers.ts) gets
 *        "check your inbox" instead: src/lib/billing/checkout-links.ts emails
 *        it either its account link (a plan is running) or a single-use link
 *        to a page with the terms without a trial (one free trial per person).
 *     The two replies differ (Paddle opens, or "check your inbox"), so the
 *     form does show whoever types an address whether it can still start a
 *     trial; see checkout-links.ts for that trade-off.
 *  2. Paddle creates the subscription and sends webhooks; handlePaddleEvent()
 *     finds the subscriber through that reference (Paddle copies a checkout's
 *     customData onto the subscription) and mirrors the subscription's status.
 *     Nothing the browser sends is trusted on its own: a trialing subscription
 *     the checkout didn't allow is canceled in Paddle, and a Paddle customer is
 *     only linked once its email matches the subscriber's address.
 *  3. Only a checkout opened from the link emailed to the address
 *     (address_proven: opening it proved the mailbox) confirms the address by
 *     paying. A checkout from the public form never does, also for a brand-new
 *     address, because anyone can type anyone's address there: an address
 *     that isn't confirmed yet gets a confirmation email once the trial (or
 *     plan) starts, and the welcome email and alerts follow its confirmation.
 *     Until then the plan doesn't count against the address's one free trial
 *     (hadTrialBefore needs confirmed_at), and leaves no trial marker. The
 *     confirmation email goes out again on days 3 and 10 of the trial, and a
 *     trial still unconfirmed 2 days before it ends is canceled in Paddle by
 *     the daily job (runBillingSafety), so it never turns into a payment.
 *  4. One running subscription per address: a second one (two checkouts
 *     finished at once) is canceled in Paddle and never applied, and the
 *     public form doesn't prepare a second trial checkout for an address
 *     while one from the last 30 minutes is still open.
 */
import { randomBytes } from "node:crypto";
import { recordEvent } from "@/lib/analytics";
import { PADDLE_PRICE_MONTHLY, PADDLE_PRICE_QUARTERLY } from "@/lib/billing/live";
import {
  cancelSubscriptionNow, getCustomer, getSubscription, isPaddleApiConfigured, isPaddleCustomerId, WEBHOOK_PADDLE_TIMEOUT_MS,
  type PaddleCallOptions, type PaddleSubscription,
} from "@/lib/billing/paddle";
import { trialUsedElsewhere } from "@/lib/billing/trial-markers";
import { UNCONFIRMED_CANCEL_DAYS } from "@/lib/early-access-copy";
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

/** The format of every token this site creates with randomBytes(24).toString("base64url") (32 characters). */
export const TOKEN_RE = /^[\w-]{20,64}$/;

// ── Checkout ─────────────────────────────────────────────────

export type StartCheckoutResult =
  /** Checkout with the catalog price and its free trial. */
  | { ok: true; ref: string; email: string; trial: true }
  /**
   * The address has a plan (live) or had one: nothing about it is shown on the
   * page; sendCheckoutLink() emails it the right next step.
   */
  | { ok: true; inbox: true; email: string; subscriberId: number; live: boolean }
  | { ok: false; error: string };

/** Shown when a returning customer's checkout (no trial) can't be prepared. */
export const CHECKOUT_UNAVAILABLE = "We couldn't open checkout. Please try again or email us.";

/** Shown when this address started a checkout in the last OPEN_CHECKOUT_MINUTES that hasn't led to a subscription yet. */
export const CHECKOUT_ALREADY_OPEN = "Your checkout is already open. If you closed it, try again in a few minutes.";
/** How long a checkout started from the public form blocks a second one for the same address. */
export const OPEN_CHECKOUT_MINUTES = 30;

/** The subscriber fields that show whether an address has had a plan before. */
export type PlanHistory = {
  /** Set once the address was confirmed (by its owner, or by paying through an emailed link); never cleared. */
  confirmed_at: Date | string | null;
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
 * Only once the address is confirmed (confirmed_at): a plan someone started
 * with an address its owner never confirmed doesn't use up the owner's trial,
 * so if it is canceled before confirmation the address may start a trial again.
 * The SQL function had_plan() (db/migrations/015_billing_safety.sql) is the
 * same rule for queries; a test checks that both agree.
 * `elsewhere`: the one-trial rule applies through something other than this
 * row: a trial marker (the address had a plan and its row was deleted; kept
 * 24 months) or another row with the same canonical address (trialUsedElsewhere
 * in trial-markers.ts). Pure, so it is unit-tested.
 */
export function hadTrialBefore(h: PlanHistory, elsewhere = false): boolean {
  if (elsewhere) return true;
  if (h.confirmed_at == null) return false;
  return Boolean(h.paddle_subscription_id) || (h.billing_status ?? "none") !== "none" || h.trial_ends_at != null || h.canceled_at != null;
}

export const priceIdFor = (plan: CheckoutPlan) => (plan === "quarterly" ? PADDLE_PRICE_QUARTERLY : PADDLE_PRICE_MONTHLY);

/**
 * Prepares a checkout from the public form. A new address gets a pending
 * subscriber row and its first saved search; no email yet (the confirmation
 * email goes out once Paddle reports the trial, see applySubscription). An
 * existing address that never had a plan is NOT changed here, because anyone
 * can type any address: its search waits in paddle_checkouts until Paddle
 * reports a subscription for this reference, and even then its email status
 * only changes once the owner confirms. An address that has or had a plan
 * gets `inbox`: the caller shows the same reply for a running plan and a past
 * one, and emails the next step.
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
  // A deleted address that had a plan, or another form of the same address that
  // had one: no second trial (one per person). This address has no row yet if the
  // insert below creates it; otherwise it is checked again without its own row.
  const marked = await trialUsedElsewhere(email);

  // A new address: the subscriber row, its first search and the checkout
  // record are written together or not at all (a half-written row would
  // otherwise be treated as an existing address on the next try).
  const created = await transaction(async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      insert into subscribers (email, status, wants_alerts, frequency, preferences, unsubscribe_token, source, attribution)
      values (${email}, 'pending', true, 'daily', '{}'::jsonb, ${newToken()}, ${opts.source ?? null}, ${attribution ? tx.json(attribution) : null})
      on conflict (email) do nothing
      returning id::int as id`;
    if (!row) return null;
    await addSavedSearch(row.id, opts.search ?? "", tx);
    if (!marked) {
      await tx`
        insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor, trial_allowed, address_proven)
        values (${ref}, ${row.id}, ${opts.plan}, ${opts.search}, true, ${opts.visitor ?? null}, true, false)`;
    }
    return row.id;
  });
  if (created !== null) {
    // A brand-new address has had no plan here: the catalog price, with its trial.
    return marked ? { ok: true, inbox: true, email, subscriberId: created, live: false } : { ok: true, ref, email, trial: true };
  }

  // checkout_created: the row was created by an earlier checkout that was never
  // finished, and nobody has touched it since (recorded as new_subscriber on the
  // checkout, for the record only: paying through the public form never confirms).
  const [existing] = await sql<(PlanHistory & { id: number; checkout_created: boolean })[]>`
    select s.id::int as id, s.confirmed_at, s.billing_status, s.paddle_subscription_id, s.trial_ends_at, s.canceled_at,
           (s.status = 'pending' and s.confirmed_at is null and s.confirm_token is null and s.paddle_subscription_id is null
            and exists (select 1 from paddle_checkouts c where c.subscriber_id = s.id and c.new_subscriber)) as checkout_created
    from subscribers s where s.email = ${email}`;
  if (!existing) return { ok: false, error: "Something went wrong on our side. Please try again in a minute." };
  // One subscription per address, and one free trial per person: the page gives
  // the same reply for both; the next step goes to the address itself.
  const live = LIVE_STATUSES.includes(existing.billing_status);
  if (live || hadTrialBefore(existing, await trialUsedElsewhere(email, existing.id))) return { ok: true, inbox: true, email, subscriberId: existing.id, live };

  // A checkout for this address started in the last 30 minutes and no subscription came of it
  // yet: the first one may still be open (or being paid), so a second free trial isn't
  // prepared alongside it (two finished checkouts would be two subscriptions).
  const [open] = await sql`
    select 1 from paddle_checkouts
    where subscriber_id = ${existing.id} and subscription_id is null
      and created_at > now() - make_interval(mins => ${OPEN_CHECKOUT_MINUTES}) limit 1`;
  if (open) return { ok: false, error: CHECKOUT_ALREADY_OPEN };

  // First-touch attribution only, as in the early-access sign-up.
  if (attribution) await sql`update subscribers set attribution = coalesce(attribution, ${sql.json(attribution)}) where id = ${existing.id}`;
  await sql`
    insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor, trial_allowed, address_proven)
    values (${ref}, ${existing.id}, ${opts.plan}, ${opts.search}, ${existing.checkout_created}, ${opts.visitor ?? null}, true, false)`;
  return { ok: true, ref, email, trial: true };
}

/**
 * After the browser sees "checkout completed": the account link, but only
 * for a checkout opened from the link emailed to the address (the mailbox is
 * proven), once the webhook has linked its subscription and the address is
 * confirmed. Everyone else gets the link by email (the welcome email, after
 * confirming the address).
 */
export async function checkoutAccountToken(ref: string): Promise<{ linked: boolean; manageToken: string | null }> {
  if (typeof ref !== "string" || !TOKEN_RE.test(ref)) return { linked: false, manageToken: null };
  const [row] = await sql<{ proven: boolean; linked: boolean; manage_token: string }[]>`
    select (c.address_proven and s.status = 'confirmed') as proven,
           (c.subscription_id is not null and s.paddle_subscription_id = c.subscription_id) as linked, s.manage_token
    from paddle_checkouts c join subscribers s on s.id = c.subscriber_id
    where c.ref = ${ref} and c.created_at > now() - interval '2 hours'`;
  if (!row) return { linked: false, manageToken: null };
  return { linked: row.linked, manageToken: row.linked && row.proven ? row.manage_token : null };
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

export type WelcomeInfo = {
  subscriberId: number;
  /** The subscription this welcome is for: a returning customer's new plan gets its own welcome. */
  subscriptionId: string;
  email: string;
  manageToken: string;
  unsubscribeToken: string;
  trialEndsAt: string | null;
  planInterval: PlanInterval | null;
};
export type ConfirmInfo = {
  subscriberId: number;
  email: string;
  confirmToken: string;
  subscriptionId: string;
  /** The account link (works before the address is confirmed: it opens billing, where the plan can be canceled). */
  manageToken: string;
  /** The trial's end, while the subscription is in its trial; null otherwise. */
  trialEndsAt: string | null;
  planInterval: PlanInterval | null;
  /** Which send this is: "start" when the plan was linked, "day3" / "day10" for the reminders during the trial. */
  sendDay?: ConfirmSendDay;
};
export type ConfirmSendDay = "start" | "day3" | "day10";
export type HandleResult = {
  /** flagged: held back for the owner to look at (Admin → Overview → Billing flags); nothing applied. */
  outcome: "duplicate" | "ignored" | "unmatched" | "applied" | "stale" | "flagged";
  welcome?: WelcomeInfo;
  /** A subscription started at an address that isn't confirmed (new or existing): email it a confirmation link. */
  confirm?: ConfirmInfo;
  /** A subscription that must not run (see CancelKind): cancel it in Paddle after the commit (cancelFlaggedSubscription). */
  cancel?: { subscriptionId: string; kind: CancelKind };
};

/** Analytics recorded after the transaction commits. */
type Effects = { trialStarted: boolean; canceled: boolean; visitor: string | null; props: Record<string, unknown> };

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created", "subscription.updated", "subscription.activated", "subscription.trialing",
  "subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.canceled",
]);

const SUB_ID_RE = /^sub_[a-z\d]{26}$/;

/**
 * Applies one verified webhook event, once per event_id.
 *
 * The event_id record and the subscriber change are written in ONE
 * transaction: they commit together or not at all. If the function is killed
 * half-way, Postgres rolls both back and Paddle's retry applies the event
 * again. A second delivery arriving while the first is still running waits
 * for it (the event_id is the primary key) and is then seen as a duplicate.
 * Calls to Paddle's API (fetching a subscription for transaction.completed,
 * checking the customer's email) happen before the transaction, so no
 * transaction stays open while waiting for Paddle. Emails, analytics and
 * canceling a blocked trial happen only after the commit.
 */
export async function handlePaddleEvent(event: PaddleEvent): Promise<HandleResult> {
  if (!event?.event_id || typeof event.event_type !== "string") return { outcome: "ignored" };
  const eventId = event.event_id.slice(0, 100);
  const occurredAt = isoOrNull(event.occurred_at) ?? new Date().toISOString();

  // The subscription snapshot to apply, if any. A repeat of an event already applied
  // costs no call to Paddle (the transaction below makes the final check).
  let sub: PaddleSubscription | null = null;
  if (SUBSCRIPTION_EVENTS.has(event.event_type) || event.event_type === "transaction.completed") {
    const [seen] = await sql`select 1 from paddle_events where event_id = ${eventId}`;
    if (seen) return { outcome: "duplicate" };
    sub = event.event_type === "transaction.completed" ? await subscriptionForTransaction(event.data) : (event.data as unknown as PaddleSubscription);
  }
  const customer = sub ? await checkCustomer(sub) : null;

  const res = await transaction(async (tx): Promise<{ result: HandleResult; effects?: Effects }> => {
    const fresh = await tx`
      insert into paddle_events (event_id, event_type, occurred_at) values (${eventId}, ${event.event_type.slice(0, 60)}, ${occurredAt})
      on conflict (event_id) do nothing returning event_id`;
    if (fresh.length === 0) return { result: { outcome: "duplicate" } };
    if (!sub) return { result: { outcome: "ignored" } };
    return applySubscription(tx, sub, occurredAt, customer);
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
  return typeof ref === "string" && TOKEN_RE.test(ref) ? ref : null;
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
  const sub = await getSubscription(subId, { timeoutMs: WEBHOOK_PADDLE_TIMEOUT_MS });
  // The fetched snapshot is current, so it may stand in for any event up to now.
  return { ...sub, custom_data: sub.custom_data ?? (data.custom_data as Record<string, unknown> | null) };
}

type CheckoutRow = { subscriber_id: number; plan: CheckoutPlan; search: string | null; visitor: string | null; address_proven: boolean; trial_allowed: boolean | null };

async function findSubscriber(db: Db, sub: PaddleSubscription) {
  const ref = refOf(sub.custom_data);
  if (ref) {
    const [c] = await db<CheckoutRow[]>`
      select subscriber_id::int as subscriber_id, plan, search, visitor, address_proven, trial_allowed from paddle_checkouts where ref = ${ref}`;
    if (c) return { subscriberId: c.subscriber_id, checkout: { ref, ...c } };
  }
  const [bySub] = await db<{ id: number }[]>`select id::int as id from subscribers where paddle_subscription_id = ${sub.id}`;
  if (bySub) return { subscriberId: bySub.id, checkout: null };
  // Only customer ids checked against the address are stored (see checkCustomer).
  if (isPaddleCustomerId(sub.customer_id)) {
    const [byCustomer] = await db<{ id: number }[]>`
      select id::int as id from subscribers where paddle_customer_id = ${sub.customer_id} order by id desc limit 1`;
    if (byCustomer) return { subscriberId: byCustomer.id, checkout: null };
  }
  return null;
}

// ── The Paddle customer behind a subscription ────────────────

/**
 * verified: the Paddle customer's email is the subscriber's address; mismatch:
 * it isn't (the checkout was tampered with: Paddle Checkout opens with the
 * address locked); unverified: it couldn't be checked (no API key, or Paddle
 * didn't answer); none: the event has no customer id.
 */
export type CustomerStatus = "verified" | "mismatch" | "unverified" | "none";
type CustomerCheck = { subscriberId: number; customerId: string | null; status: CustomerStatus; reason?: string };

/** Compares the Paddle customer's email (GET /customers/{id}, customer.read) with the address. */
export async function verifyCustomerEmail(customerId: string, email: string, opts: PaddleCallOptions = {}): Promise<{ status: Exclude<CustomerStatus, "none">; reason?: string }> {
  if (!isPaddleApiConfigured()) return { status: "unverified", reason: "PADDLE_API_KEY is not set" };
  try {
    const c = await getCustomer(customerId, opts);
    return normalizeEmail(String(c?.email ?? "")) === email ? { status: "verified" } : { status: "mismatch" };
  } catch (e) {
    return { status: "unverified", reason: (e as Error).message };
  }
}

/** Before the transaction: which subscriber the event is for, and whether its Paddle customer is that address. */
async function checkCustomer(sub: PaddleSubscription): Promise<CustomerCheck | null> {
  if (typeof sub?.id !== "string" || !SUB_ID_RE.test(sub.id)) return null;
  const target = await findSubscriber(sql, sub);
  if (!target) return null;
  const customerId = isPaddleCustomerId(sub.customer_id) ? sub.customer_id : null;
  if (!customerId) return { subscriberId: target.subscriberId, customerId: null, status: "none" };
  const [row] = await sql<{ email: string; paddle_customer_id: string | null; verified: boolean }[]>`
    select email, paddle_customer_id, paddle_customer_verified_at is not null as verified from subscribers where id = ${target.subscriberId}`;
  if (!row) return null;
  if (row.paddle_customer_id === customerId && row.verified) return { subscriberId: target.subscriberId, customerId, status: "verified" };
  // Already found not to match: don't ask Paddle again for every event of this subscription.
  const [known] = await sql`
    select 1 from billing_flags where subscription_id = ${sub.id} and kind = 'customer_mismatch' and customer_id = ${customerId} and resolved_at is null`;
  if (known) return { subscriberId: target.subscriberId, customerId, status: "mismatch" };
  return { subscriberId: target.subscriberId, customerId, ...(await verifyCustomerEmail(customerId, row.email, { timeoutMs: WEBHOOK_PADDLE_TIMEOUT_MS })) };
}

export type BillingFlagKind = "trial_blocked" | "customer_mismatch" | "customer_unverified" | "duplicate_subscription" | "trial_unconfirmed";
/**
 * Flags whose subscription is canceled in Paddle at once:
 *  trial_blocked           a free trial this address may not have (one per email address);
 *  duplicate_subscription  a second running subscription for an address that has one;
 *  trial_unconfirmed       a trial at an address nobody confirmed, about to end.
 */
export type CancelKind = Extract<BillingFlagKind, "trial_blocked" | "duplicate_subscription" | "trial_unconfirmed">;

/** Records (or refreshes) a flag shown on Admin → Overview. No email address is stored in it. */
async function flag(db: Db, f: { subscriptionId: string; kind: BillingFlagKind; subscriberId: number | null; customerId: string | null; detail: string }) {
  await db`
    insert into billing_flags (subscription_id, kind, subscriber_id, customer_id, detail)
    values (${f.subscriptionId}, ${f.kind}, ${f.subscriberId}, ${f.customerId}, ${f.detail.slice(0, 500)})
    on conflict (subscription_id, kind) do update set
      subscriber_id = excluded.subscriber_id, customer_id = excluded.customer_id, detail = excluded.detail, updated_at = now(), resolved_at = null`;
}

/** What each cancel flag says while the cancel is on its way, and once Paddle confirmed it (cancel_done_at). */
export const CANCEL_DETAIL: Record<CancelKind, { pending: string; done: string }> = {
  trial_blocked: {
    pending: "A free trial this address may not have (one per email address). Canceling it in Paddle; alerts stay off.",
    done: "Canceled in Paddle at once, so nothing is charged. Alerts stayed off; no welcome was sent.",
  },
  duplicate_subscription: {
    pending: "A second running subscription for an address that already has one. Canceling it in Paddle; it was not applied.",
    done: "Canceled in Paddle at once; it was never applied. If Paddle took a payment for it, refund that payment in Paddle.",
  },
  trial_unconfirmed: {
    pending: "A free trial at an address that was never confirmed, ending within 2 days. Canceling it in Paddle so nothing is charged.",
    done: "Canceled in Paddle at once, so nothing is charged: the address was never confirmed. No email was sent about it.",
  },
};

/**
 * Cancels a flagged subscription in Paddle straight away (POST
 * /subscriptions/{id}/cancel, effective_from immediately; needs
 * subscription.write) and records the outcome on its flag: cancel_done_at once
 * Paddle confirmed it. If Paddle refuses, the flag says so and the daily job
 * (runBillingSafety) tries again until it works or the owner resolves the flag;
 * a subscription Paddle already shows as canceled counts as done. Alerts stay
 * off either way. Never throws.
 */
export async function cancelFlaggedSubscription(subscriptionId: string, kind: CancelKind, opts: PaddleCallOptions = {}): Promise<boolean> {
  const done = async () => {
    await sql`
      update billing_flags set detail = ${CANCEL_DETAIL[kind].done}, cancel_done_at = coalesce(cancel_done_at, now()), updated_at = now()
      where subscription_id = ${subscriptionId} and kind = ${kind}`;
    return true;
  };
  try {
    if (!isPaddleApiConfigured()) throw new Error("PADDLE_API_KEY is not set");
    await cancelSubscriptionNow(subscriptionId, opts);
    return await done();
  } catch (e) {
    const msg = (e as Error).message;
    // Already canceled (by hand, or by an earlier try whose answer was lost): nothing left to do.
    const status = isPaddleApiConfigured() ? await getSubscription(subscriptionId, opts).then((x) => x.status, () => null) : null;
    if (status === "canceled") return done().catch(() => false);
    console.error(`paddle: flagged subscription (${kind}) not canceled`, msg);
    await sql`
      update billing_flags set detail = ${`Cancel in Paddle failed (${msg}). The daily job tries again; you can also cancel this subscription by hand in Paddle. Alerts stay off.`.slice(0, 500)}, updated_at = now()
      where subscription_id = ${subscriptionId} and kind = ${kind}`.catch(() => {});
    return false;
  }
}

async function applySubscription(tx: Tx, sub: PaddleSubscription, occurredAt: string, check: CustomerCheck | null): Promise<{ result: HandleResult; effects?: Effects }> {
  if (typeof sub?.id !== "string" || !SUB_ID_RE.test(sub.id)) return { result: { outcome: "ignored" } };
  const target = await findSubscriber(tx, sub);
  if (!target) {
    // E.g. a simulated event, or a subscription created outside this site.
    console.warn(`paddle webhook: no subscriber for ${sub.id}`);
    return { result: { outcome: "unmatched" } };
  }
  const b = billingFromSubscription(sub);
  if (b.status === "none") return { result: { outcome: "ignored" } };

  // A subscription held back earlier stays held back. One whose cancel hasn't gone
  // through yet is canceled again while it still runs (a blocked trial while trialing).
  const [held] = await tx<{ kind: BillingFlagKind; done: boolean }[]>`
    select kind, cancel_done_at is not null as done from billing_flags
    where subscription_id = ${sub.id} and kind in ('trial_blocked', 'duplicate_subscription', 'customer_mismatch') and resolved_at is null
    order by kind = 'customer_mismatch', kind limit 1`;
  if (held) {
    const retry = !held.done && (held.kind === "trial_blocked" ? b.status === "trialing" : held.kind === "duplicate_subscription" && LIVE_STATUSES.includes(b.status));
    return { result: { outcome: "flagged", ...(retry ? { cancel: { subscriptionId: sub.id, kind: held.kind as CancelKind } } : {}) } };
  }

  // The customer check was made for this subscriber before the transaction; if the
  // reference now points elsewhere (it can't, but just in case), link no customer.
  const customerId = isPaddleCustomerId(sub.customer_id) ? sub.customer_id : null;
  const customer: CustomerCheck = check && check.subscriberId === target.subscriberId
    ? check
    : { subscriberId: target.subscriberId, customerId, status: customerId ? "unverified" : "none", reason: "not checked" };
  if (customer.status === "mismatch") {
    await flag(tx, {
      subscriptionId: sub.id, kind: "customer_mismatch", subscriberId: target.subscriberId, customerId,
      detail: "The Paddle customer's email is not this subscriber's address. The subscription was not linked and alerts stay off; cancel or refund it in Paddle if it shouldn't run.",
    });
    console.warn(`paddle webhook: customer of ${sub.id} doesn't match the subscriber; held back`);
    return { result: { outcome: "flagged" } };
  }

  // One running subscription per address. Two checkouts finished at about the same time
  // (two tabs, or two emailed links) make two subscriptions: the one applied first stays,
  // any other that runs while it runs is canceled in Paddle and never applied. The row is
  // locked, so two such events can't both see the address without a subscription.
  if (LIVE_STATUSES.includes(b.status)) {
    const [cur] = await tx<{ paddle_subscription_id: string | null; billing_status: BillingStatus }[]>`
      select paddle_subscription_id, billing_status from subscribers where id = ${target.subscriberId} for update`;
    if (cur?.paddle_subscription_id && cur.paddle_subscription_id !== sub.id && LIVE_STATUSES.includes(cur.billing_status)) {
      await flag(tx, { subscriptionId: sub.id, kind: "duplicate_subscription", subscriberId: target.subscriberId, customerId, detail: CANCEL_DETAIL.duplicate_subscription.pending });
      console.warn(`paddle webhook: ${sub.id} is a second running subscription for one address; canceling`);
      return { result: { outcome: "flagged", cancel: { subscriptionId: sub.id, kind: "duplicate_subscription" } } };
    }
  }

  // One free trial per person. A trial arriving for a checkout that didn't
  // allow one (a returning customer's reference used with the catalog price),
  // or for a confirmed address that had another subscription, or one whose
  // canonical form had one or left a trial marker, is canceled in Paddle and
  // never applied.
  if (b.status === "trialing") {
    const [h] = await tx<(PlanHistory & { email: string })[]>`
      select email, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at from subscribers where id = ${target.subscriberId}`;
    if (h && h.paddle_subscription_id !== sub.id) {
      const notAllowed = target.checkout?.trial_allowed === false;
      if (notAllowed || hadTrialBefore(h, await trialUsedElsewhere(h.email, target.subscriberId, tx))) {
        await flag(tx, { subscriptionId: sub.id, kind: "trial_blocked", subscriberId: target.subscriberId, customerId, detail: CANCEL_DETAIL.trial_blocked.pending });
        console.warn(`paddle webhook: trial ${sub.id} not allowed for this address; canceling`);
        return { result: { outcome: "flagged", cancel: { subscriptionId: sub.id, kind: "trial_blocked" } } };
      }
    }
  }

  const live = LIVE_STATUSES.includes(b.status);
  const alerts = ALERT_STATUSES.includes(b.status);
  const fallbackInterval: PlanInterval | null = target.checkout ? (target.checkout.plan === "quarterly" ? "quarter" : "month") : null;
  // Paying confirms the address only when the checkout came from the link we emailed
  // to it (its owner opened it). Any other address that isn't confirmed yet, a new
  // one typed into the public form included, gets a confirmation email instead.
  const paymentConfirms = live && Boolean(target.checkout?.address_proven);
  // Only a customer whose email is this address is linked (portal sessions open for it).
  const linkCustomer = customer.status === "verified" ? customer.customerId : null;

  // One statement: lock the row, keep its previous values, apply the change.
  // Skipped when the event is older than the last one applied for this
  // subscription, or when it would overwrite a different subscription that
  // is still running (a second running one is canceled above; a canceled one
  // never replaces it).
  const [row] = await tx<{
    prev_sub: string | null; prev_status: BillingStatus; prev_welcome: boolean;
    email: string; status: string; manage_token: string; unsubscribe_token: string; confirm_token: string | null;
    attribution: Record<string, string> | null; trial_ends_at: Date | null; plan_interval: PlanInterval | null;
  }[]>`
    with prev as (
      select id, paddle_subscription_id, billing_status,
             -- The welcome went out for THIS subscription (a returning customer's new plan gets its own).
             (welcome_sent_at is not null and paddle_subscription_id = ${sub.id}) as welcome,
             paddle_subscription_id is distinct from ${sub.id} as new_sub,
             -- A running subscription this row didn't have before.
             (${live}::boolean and paddle_subscription_id is distinct from ${sub.id}) as live_link,
             case when ${paymentConfirms}::boolean and paddle_subscription_id is distinct from ${sub.id} then 'confirmed' else status end as next_status
      from subscribers where id = ${target.subscriberId} for update
    )
    update subscribers s set
      paddle_customer_id = coalesce(${linkCustomer}, s.paddle_customer_id),
      paddle_customer_verified_at = case when ${linkCustomer}::text is null then s.paddle_customer_verified_at
                                         when s.paddle_customer_id = ${linkCustomer} then coalesce(s.paddle_customer_verified_at, now())
                                         else now() end,
      paddle_subscription_id = ${sub.id},
      billing_status = ${b.status},
      plan = ${alerts ? "premium" : "free"},
      plan_interval = coalesce(${b.planInterval ?? fallbackInterval}, s.plan_interval),
      -- The trial of THIS subscription: a different one (a returning customer's plan,
      -- which has no trial) must not inherit the date of an earlier trial.
      trial_ends_at = case when prev.new_sub then ${b.trialEndsAt}::timestamptz
                           else coalesce(${b.trialEndsAt}::timestamptz, s.trial_ends_at) end,
      current_period_end = ${b.currentPeriodEnd},
      canceled_at = ${b.canceledAt},
      cancel_at = ${b.cancelAt},
      billing_event_at = ${occurredAt},
      -- An address proven by the emailed checkout link is confirmed by paying.
      -- Any other address keeps its status; a newly linked running subscription
      -- gets a confirmation link if it isn't confirmed (sent after the commit).
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
      trial_reminder_sent_at = case when prev.new_sub then null else s.trial_reminder_sent_at end,
      trial_reminder_claimed_at = case when prev.new_sub then null else s.trial_reminder_claimed_at end,
      -- Claimed here, sent after the commit; reset if sending fails (welcomeNotSent). welcome_claimed_at
      -- is the lease: cleared once sent (welcomeSent), and the daily job picks up a claim older than 30 minutes.
      -- A different subscription starts again: its welcome is owed, whatever was sent for an earlier one.
      welcome_sent_at = case when ${alerts} and prev.next_status = 'confirmed'
                               then case when prev.new_sub then now() else coalesce(s.welcome_sent_at, now()) end
                             when prev.new_sub then null
                             else s.welcome_sent_at end,
      welcome_claimed_at = case when ${alerts} and prev.next_status = 'confirmed' and (prev.new_sub or s.welcome_sent_at is null) then now()
                                when prev.new_sub then null
                                else s.welcome_claimed_at end
    from prev
    where s.id = prev.id
      and (prev.paddle_subscription_id is distinct from ${sub.id} or s.billing_event_at is null or s.billing_event_at <= ${occurredAt})
      and (prev.paddle_subscription_id is null or prev.paddle_subscription_id = ${sub.id}
           or prev.billing_status not in ('trialing', 'active', 'past_due', 'paused'))
    returning prev.paddle_subscription_id as prev_sub, prev.billing_status as prev_status, prev.welcome as prev_welcome,
              s.email, s.status, s.manage_token, s.unsubscribe_token, s.confirm_token, s.attribution, s.trial_ends_at, s.plan_interval`;
  if (!row) return { result: { outcome: "stale" } };

  // The customer: checked now (any earlier "couldn't check" flag is settled), or still to check.
  if (linkCustomer) {
    await tx`update billing_flags set resolved_at = now(), updated_at = now() where subscription_id = ${sub.id} and kind = 'customer_unverified' and resolved_at is null`;
  } else if (customer.status === "unverified" && customerId) {
    await flag(tx, {
      subscriptionId: sub.id, kind: "customer_unverified", subscriberId: target.subscriberId, customerId,
      detail: `The Paddle customer couldn't be checked against the address (${customer.reason ?? "unknown"}), so it isn't linked yet. It is checked again with the next event or when billing is opened.`,
    });
  }

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
        ? {
            subscriberId: target.subscriberId, subscriptionId: sub.id, email: row.email, manageToken: row.manage_token, unsubscribeToken: row.unsubscribe_token,
            trialEndsAt: welcomeTrialEnd(b.status, row.trial_ends_at), planInterval: row.plan_interval,
          }
        : undefined,
      confirm: fx.askConfirm && row.confirm_token
        ? {
            subscriberId: target.subscriberId, email: row.email, confirmToken: row.confirm_token, subscriptionId: sub.id, manageToken: row.manage_token,
            trialEndsAt: welcomeTrialEnd(b.status, row.trial_ends_at), planInterval: row.plan_interval, sendDay: "start",
          }
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

// ── Daily safety checks ──────────────────────────────────────

/** A trial at an address nobody confirmed is canceled once it ends within this many days (the daily job runs once a day). */
export { UNCONFIRMED_CANCEL_DAYS };

export type BillingSafetyResult =
  | {
      /** Trials at addresses nobody confirmed, canceled before their first payment. */
      unconfirmed: { canceled: number; failed: number };
      /** Earlier cancels (blocked trials, second subscriptions) that hadn't gone through. */
      cancelRetries: { canceled: number; failed: number };
      /** Paddle customers that couldn't be checked against the address when their event came in. */
      customers: { verified: number; mismatch: number; unverified: number };
    }
  | { skipped: string };

/**
 * Daily job (scheduled emails run), before the plan emails:
 *  1. A trial whose address is still waiting for confirmation (the SQL function
 *     awaiting_confirmation(), db/migrations/015) and which ends within
 *     UNCONFIRMED_CANCEL_DAYS is canceled in Paddle at once and flagged
 *     (trial_unconfirmed), so it never turns into a payment. No email is sent.
 *  2. Cancels of blocked trials and second subscriptions that failed earlier
 *     (open flags without cancel_done_at) are tried again.
 *  3. Paddle customers that couldn't be checked against the address (open
 *     customer_unverified flags) are checked again: a match is linked, a
 *     mismatch is flagged for the owner.
 * Needs PADDLE_API_KEY (and NEXT_PUBLIC_PADDLE_ENV for live) in the scheduled job.
 */
export async function runBillingSafety(limit = 200): Promise<BillingSafetyResult> {
  if (!isPaddleApiConfigured()) return { skipped: "PADDLE_API_KEY is not set, so nothing could be canceled or checked in Paddle." };

  // 1. Unconfirmed trials about to end.
  const unconfirmed = { canceled: 0, failed: 0 };
  const ending = await sql<{ id: number; sub: string; customer: string | null }[]>`
    select s.id::int as id, s.paddle_subscription_id as sub, s.paddle_customer_id as customer from subscribers s
    where s.billing_status = 'trialing' and s.paddle_subscription_id is not null and awaiting_confirmation(s)
      and s.trial_ends_at is not null and s.trial_ends_at <= now() + make_interval(days => ${UNCONFIRMED_CANCEL_DAYS})
      -- A cancel already scheduled for the trial's end: nothing will be charged.
      and (s.cancel_at is null or s.cancel_at > s.trial_ends_at)
      and not exists (select 1 from billing_flags f where f.subscription_id = s.paddle_subscription_id and f.kind = 'trial_unconfirmed' and f.cancel_done_at is not null)
    order by s.trial_ends_at limit ${limit}`;
  for (const r of ending) {
    await flag(sql, { subscriptionId: r.sub, kind: "trial_unconfirmed", subscriberId: r.id, customerId: r.customer, detail: CANCEL_DETAIL.trial_unconfirmed.pending });
    if (await cancelFlaggedSubscription(r.sub, "trial_unconfirmed")) unconfirmed.canceled++;
    else unconfirmed.failed++;
  }

  // 2. Cancels that didn't go through when the webhook asked for them.
  const cancelRetries = { canceled: 0, failed: 0 };
  const pending = await sql<{ subscription_id: string; kind: CancelKind }[]>`
    select subscription_id, kind from billing_flags
    where kind in ('trial_blocked', 'duplicate_subscription') and resolved_at is null and cancel_done_at is null
    order by updated_at limit ${limit}`;
  for (const f of pending) {
    if (await cancelFlaggedSubscription(f.subscription_id, f.kind)) cancelRetries.canceled++;
    else cancelRetries.failed++;
  }

  // 3. Customers not checked yet.
  const customers = { verified: 0, mismatch: 0, unverified: 0 };
  const unchecked = await sql<{ subscription_id: string; customer_id: string; subscriber_id: number; email: string }[]>`
    select f.subscription_id, f.customer_id, s.id::int as subscriber_id, s.email
    from billing_flags f join subscribers s on s.id = f.subscriber_id
    where f.kind = 'customer_unverified' and f.resolved_at is null and f.customer_id is not null
    order by f.updated_at limit ${limit}`;
  for (const u of unchecked) {
    if (!isPaddleCustomerId(u.customer_id)) continue;
    const v = await verifyCustomerEmail(u.customer_id, u.email);
    if (v.status === "verified") {
      customers.verified++;
      await sql`
        update subscribers set paddle_customer_id = ${u.customer_id}, paddle_customer_verified_at = now()
        where id = ${u.subscriber_id} and paddle_subscription_id = ${u.subscription_id}`;
      await sql`update billing_flags set resolved_at = now(), updated_at = now() where subscription_id = ${u.subscription_id} and kind = 'customer_unverified' and resolved_at is null`;
    } else if (v.status === "mismatch") {
      customers.mismatch++;
      await flag(sql, {
        subscriptionId: u.subscription_id, kind: "customer_mismatch", subscriberId: u.subscriber_id, customerId: u.customer_id,
        detail: "Found by the daily check: the Paddle customer's email is not this subscriber's address. The customer was not linked; cancel or refund the subscription in Paddle if it shouldn't run.",
      });
      await sql`update billing_flags set resolved_at = now(), updated_at = now() where subscription_id = ${u.subscription_id} and kind = 'customer_unverified' and resolved_at is null`;
    } else {
      customers.unverified++;
    }
  }
  return { unconfirmed, cancelRetries, customers };
}

// ── Opening billing (customer portal) ────────────────────────

export type BillingTarget = {
  id: number;
  email: string;
  paddle_customer_id: string | null;
  paddle_customer_verified_at: Date | string | null;
  paddle_subscription_id: string | null;
};

/**
 * The Paddle customer to open a portal session for, only ever one whose email
 * is this subscriber's address. A customer id stored before that check existed
 * (or not linked because Paddle couldn't be asked) is checked now: through the
 * subscription when no customer is stored. null when there is none, it can't
 * be checked, or it belongs to someone else (then it is unlinked and flagged).
 */
export async function verifiedCustomerFor(s: BillingTarget): Promise<string | null> {
  if (s.paddle_customer_id && s.paddle_customer_verified_at) return s.paddle_customer_id;
  if (!isPaddleApiConfigured()) return null;
  let customerId = s.paddle_customer_id;
  if (!customerId && s.paddle_subscription_id && SUB_ID_RE.test(s.paddle_subscription_id)) {
    customerId = await getSubscription(s.paddle_subscription_id).then((x) => x.customer_id, () => null);
  }
  if (!isPaddleCustomerId(customerId)) return null;
  const v = await verifyCustomerEmail(customerId, s.email);
  if (v.status === "verified") {
    await sql`update subscribers set paddle_customer_id = ${customerId}, paddle_customer_verified_at = now() where id = ${s.id}`;
    if (s.paddle_subscription_id) {
      await sql`update billing_flags set resolved_at = now(), updated_at = now() where subscription_id = ${s.paddle_subscription_id} and kind = 'customer_unverified' and resolved_at is null`;
    }
    return customerId;
  }
  if (v.status === "mismatch") {
    await sql`update subscribers set paddle_customer_id = null, paddle_customer_verified_at = null where id = ${s.id} and paddle_customer_id = ${customerId}`;
    if (s.paddle_subscription_id) {
      await flag(sql, {
        subscriptionId: s.paddle_subscription_id, kind: "customer_mismatch", subscriberId: s.id, customerId,
        detail: "Found when billing was opened: the Paddle customer's email is not this subscriber's address. The customer was unlinked; no portal was opened.",
      });
    }
    console.warn("billing: stored Paddle customer doesn't match the subscriber; unlinked");
  }
  return null;
}
