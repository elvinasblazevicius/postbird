/**
 * Paid daily alerts: starting a checkout and applying Paddle webhook events
 * to subscribers. Server only. The flow is described in the README (Billing).
 *
 * Why it is shaped this way: anyone can type anyone's address into the public
 * form, so nothing the browser sends is trusted on its own. Only a checkout
 * opened from a link that reached the mailbox (address_proven) confirms the
 * address by paying; any other plan waits for the owner to confirm, doesn't
 * count against their one free trial until then, and is canceled before it can
 * charge if nobody confirms. One running subscription per address: a second
 * one is canceled in Paddle and never applied.
 */
import { randomBytes } from "node:crypto";
import { recordEvent } from "@/lib/analytics";
import { recordOpsEvent } from "@/lib/ops-events";
import { ALERT_STATUSES, BILLING_FLAG_KINDS, LIVE_STATUSES, type BillingFlagKind, type BillingStatus } from "@/lib/billing/statuses";
import { PADDLE_PRICE_MONTHLY, PADDLE_PRICE_QUARTERLY } from "@/lib/billing/live";
import {
  cancelSubscriptionNow, getCustomer, getSubscription, isPaddleApiConfigured, isPaddleCustomerId, WEBHOOK_PADDLE_TIMEOUT_MS,
  type PaddleCallOptions, type PaddleSubscription,
} from "@/lib/billing/paddle";
import { renewalTermsVersion } from "@/lib/billing/renewal-consent";
import { trialUsedElsewhere } from "@/lib/billing/trial-markers";
import { UNCONFIRMED_CANCEL_DAYS } from "@/lib/early-access-copy";
import { sql, transaction, type Db, type Tx } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { duplicatePlanEmail } from "@/lib/email-templates";
import { addSavedSearch } from "@/lib/saved-searches";
import { normalizeEmail } from "@/lib/subscribers";

export type CheckoutPlan = "monthly" | "quarterly";
export type PlanInterval = "month" | "quarter";

// Defined once in ./statuses (no imports there, so saved-searches.ts etc. can use them without a cycle).
export { ALERT_STATUSES, BILLING_FLAG_KINDS, LIVE_STATUSES, type BillingFlagKind, type BillingStatus };

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

/** How long a checkout started from the public form blocks a second one for the same address (another visitor's). */
export const OPEN_CHECKOUT_MINUTES = 5;
/** Shown when this address started a checkout in the last OPEN_CHECKOUT_MINUTES that hasn't led to a subscription yet. */
export const CHECKOUT_ALREADY_OPEN = `Your checkout is already open. If you closed it, try again in ${OPEN_CHECKOUT_MINUTES} minutes.`;

/** The subscriber fields that show whether an address has had a plan before. */
export type PlanHistory = {
  /** Set once the address was confirmed (by its owner, or by paying through an emailed link); never cleared. */
  confirmed_at: Date | string | null;
  paddle_subscription_id: string | null;
  billing_status: BillingStatus;
  trial_ends_at: Date | string | null;
  canceled_at: Date | string | null;
  /**
   * A trial canceled by the daily job because the address wasn't confirmed in time (the
   * subscription id; see runBillingSafety). While it is still the row's subscription, the
   * row's plan fields don't count: its owner never had that trial.
   */
  unconfirmed_trial_sub: string | null;
};

/**
 * One free trial per person: has this address had a Paddle subscription
 * before? Every subscription sold here started with a trial unless the address
 * had had one, so any earlier subscription counts. The webhook never clears
 * these fields, so any one of them is enough. Only once the address is
 * confirmed: a plan someone else started with an unproven address must not use
 * up its owner's trial, nor one that ended while the address was still unproven
 * (unconfirmed_trial_sub), even if the owner confirms later.
 * `elsewhere`: a trial marker or another spelling of the address had a plan
 * (trialUsedElsewhere). Same rule as the SQL had_plan() (migration 016); a test
 * checks both agree.
 */
export function hadTrialBefore(h: PlanHistory, elsewhere = false): boolean {
  if (elsewhere) return true;
  if (h.confirmed_at == null) return false;
  if (h.unconfirmed_trial_sub && h.paddle_subscription_id === h.unconfirmed_trial_sub) return false;
  return Boolean(h.paddle_subscription_id) || (h.billing_status ?? "none") !== "none" || h.trial_ends_at != null || h.canceled_at != null;
}

/**
 * A plan linked to this address is waiting for its owner to confirm it: only an
 * address that was never confirmed (a confirmed owner who unsubscribed stays
 * proven, whatever a stranger types into a sign-up form). Same rule as the SQL
 * awaiting_confirmation() (migration 017); a test checks both agree.
 */
export function awaitingConfirmation(s: { status: string; confirmed_at: Date | string | null }): boolean {
  return s.status !== "confirmed" && s.confirmed_at == null;
}

export const priceIdFor = (plan: CheckoutPlan) => (plan === "quarterly" ? PADDLE_PRICE_QUARTERLY : PADDLE_PRICE_MONTHLY);

/**
 * Prepares a checkout from the public form. An existing address is never
 * changed here (anyone can type it): its search waits in paddle_checkouts until
 * Paddle reports a subscription. A confirmed address, and one that has or had a
 * plan, gets `inbox`: one reply for all of them, the next step by email.
 */
export async function startCheckout(opts: {
  email: string;
  plan: CheckoutPlan;
  search: string | null;
  source?: string;
  attribution?: Record<string, string> | null;
  visitor?: string | null;
  /** The "renews automatically" box was ticked (checked by startCheckoutAction): recorded on the checkout. */
  renewalConsent?: boolean;
}): Promise<StartCheckoutResult> {
  const email = normalizeEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const ref = newToken();
  // The public form always offers the trial, so the trial wording is what was agreed to.
  const consentVersion = opts.renewalConsent ? renewalTermsVersion(true, opts.plan) : null;
  const attribution = opts.attribution ?? null;
  const marked = await trialUsedElsewhere(email);

  // All or nothing: a half-written row would be treated as an existing address on the next try.
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
        insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor, trial_allowed, address_proven, renewal_consent_at, renewal_terms_version)
        values (${ref}, ${row.id}, ${opts.plan}, ${opts.search}, true, ${opts.visitor ?? null}, true, false,
                case when ${consentVersion}::text is not null then now() end, ${consentVersion})`;
    }
    return row.id;
  });
  if (created !== null) {
    return marked ? { ok: true, inbox: true, email, subscriberId: created, live: false } : { ok: true, ref, email, trial: true };
  }

  // checkout_created: left by an earlier unfinished checkout and untouched since (for the record only).
  const [existing] = await sql<(PlanHistory & { id: number; checkout_created: boolean })[]>`
    select s.id::int as id, s.confirmed_at, s.billing_status, s.paddle_subscription_id, s.trial_ends_at, s.canceled_at, s.unconfirmed_trial_sub,
           (s.status = 'pending' and s.confirmed_at is null and s.confirm_token is null and s.paddle_subscription_id is null
            and exists (select 1 from paddle_checkouts c where c.subscriber_id = s.id and c.new_subscriber)) as checkout_created
    from subscribers s where s.email = ${email}`;
  if (!existing) return { ok: false, error: "Something went wrong on our side. Please try again in a minute." };
  const live = LIVE_STATUSES.includes(existing.billing_status);
  if (live || hadTrialBefore(existing, await trialUsedElsewhere(email, existing.id))) return { ok: true, inbox: true, email, subscriberId: existing.id, live };
  // Its owner is known, so a stranger must not be able to start (and use up) its trial from here.
  if (existing.confirmed_at != null) return { ok: true, inbox: true, email, subscriberId: existing.id, live: false };

  // A recent checkout may still be open or being paid: two finished checkouts would be two
  // subscriptions. The same visitor asking again gets that one back.
  const [open] = await sql<{ ref: string; visitor: string | null }[]>`
    select ref, visitor from paddle_checkouts
    where subscriber_id = ${existing.id} and subscription_id is null
      and created_at > now() - make_interval(mins => ${OPEN_CHECKOUT_MINUTES})
    order by created_at desc limit 1`;
  if (open) {
    if (opts.visitor && open.visitor === opts.visitor) {
      await sql`
        update paddle_checkouts set plan = ${opts.plan}, search = ${opts.search},
          renewal_consent_at = case when ${consentVersion}::text is not null then now() else renewal_consent_at end,
          renewal_terms_version = coalesce(${consentVersion}, renewal_terms_version)
        where ref = ${open.ref} and subscription_id is null`;
      return { ok: true, ref: open.ref, email, trial: true };
    }
    return { ok: false, error: CHECKOUT_ALREADY_OPEN };
  }

  // First-touch attribution only, as in the early-access sign-up.
  if (attribution) await sql`update subscribers set attribution = coalesce(attribution, ${sql.json(attribution)}) where id = ${existing.id}`;
  await sql`
    insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor, trial_allowed, address_proven, renewal_consent_at, renewal_terms_version)
    values (${ref}, ${existing.id}, ${opts.plan}, ${opts.search}, ${existing.checkout_created}, ${opts.visitor ?? null}, true, false,
            case when ${consentVersion}::text is not null then now() end, ${consentVersion})`;
  return { ok: true, ref, email, trial: true };
}

/**
 * After the browser sees "checkout completed": the account link, only for a
 * checkout whose address is proven (anyone else could be at that browser).
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
 * Applies one verified webhook event, once per event_id. The event record and
 * the subscriber change commit together, so a killed run is simply retried by
 * Paddle, and a concurrent delivery waits on the primary key and is then a
 * duplicate. Paddle API calls happen before the transaction (none stays open
 * while waiting for Paddle); emails, analytics and cancels after the commit.
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
    done: "Canceled in Paddle at once; it was never applied. The customer was emailed that a duplicate was canceled and that replying gets the charge refunded. If Paddle took a payment for it (Paddle → Transactions, this subscription), refund that transaction in full in Paddle, and when the customer replies, tell them it is done.",
  },
  trial_unconfirmed: {
    pending: "A free trial at an address that was never confirmed, ending within 2 days. Canceling it in Paddle so nothing is charged.",
    done: "Canceled in Paddle at once, so nothing is charged: the address was never confirmed. No email was sent about it.",
  },
};

/**
 * What a trial_unconfirmed flag says once the trial has ended without the cancel going through
 * (the subscription is active, past due or paused: Paddle may have taken the first payment), and
 * when the daily job stops retrying it.
 */
export const UNCONFIRMED_DETAIL = {
  /** Canceled after the trial had ended. */
  convertedDone: "Canceled in Paddle at once: the address was never confirmed, but the trial had already ended, so a payment may have been taken. Refund it in full in Paddle (Transactions → this subscription). No email was sent about it.",
  /** The owner confirmed the address before the cancel went through: the plan is theirs and keeps running. */
  confirmed: "Not canceled: the address was confirmed before the cancel went through, so the plan keeps running. Nothing to do.",
  /** The subscription stopped running (or the address has another one) before the cancel went through. */
  ended: "No longer retried: this subscription stopped running here (ended in Paddle, or replaced) before the cancel went through. If Paddle took a payment for it (Transactions → this subscription), refund it: the address was never confirmed.",
} as const;

/** The flag text after a cancel that failed: what is at stake, and that the daily job tries again. */
export function cancelFailedDetail(kind: CancelKind, message: string, converted = false): string {
  const failed = `Cancel in Paddle failed (${message}).`;
  if (kind === "trial_unconfirmed" && converted) {
    return `${failed} The address was never confirmed and the trial has ended, so a payment may already have been taken. The daily job tries again while the address stays unconfirmed; you can also cancel it by hand in Paddle. Then refund the payment in Paddle (Transactions → this subscription).`.slice(0, 500);
  }
  if (kind === "trial_unconfirmed") {
    return `${failed} The daily job tries again while the address stays unconfirmed; to be sure nothing is charged, you can also cancel it by hand in Paddle before the trial ends. Alerts stay off.`.slice(0, 500);
  }
  return `${failed} The daily job tries again; you can also cancel this subscription by hand in Paddle. Alerts stay off.`.slice(0, 500);
}

/**
 * Cancels a flagged subscription in Paddle at once and records the outcome on
 * its flag (cancel_done_at). A failed cancel is retried by the daily job, so a
 * flagged plan can never quietly turn into a payment. Never throws.
 * converted (trial_unconfirmed only): the trial already ended, so the flag says a payment may
 * have been taken and must be refunded.
 */
export async function cancelFlaggedSubscription(subscriptionId: string, kind: CancelKind, opts: PaddleCallOptions & { converted?: boolean } = {}): Promise<boolean> {
  const { converted = false, ...callOpts } = opts;
  const doneDetail = kind === "trial_unconfirmed" && converted ? UNCONFIRMED_DETAIL.convertedDone : CANCEL_DETAIL[kind].done;
  const done = async () => {
    // first: Paddle confirmed this cancel just now (not an earlier try), so the note below goes out once.
    const [row] = await sql<{ first: boolean; subscriber_id: number | null }[]>`
      update billing_flags f set detail = ${doneDetail}, cancel_done_at = coalesce(f.cancel_done_at, now()), updated_at = now()
      from (select subscription_id, kind, cancel_done_at as before from billing_flags
            where subscription_id = ${subscriptionId} and kind = ${kind} for update) p
      where f.subscription_id = p.subscription_id and f.kind = p.kind
      returning p.before is null as first, f.subscriber_id::int as subscriber_id`;
    if (kind === "trial_unconfirmed") await markUnconfirmedTrialCanceled(subscriptionId);
    if (kind === "duplicate_subscription" && row?.first && row.subscriber_id) await sendDuplicateNotice(row.subscriber_id, subscriptionId);
    return true;
  };
  try {
    if (!isPaddleApiConfigured()) throw new Error("PADDLE_API_KEY is not set");
    await cancelSubscriptionNow(subscriptionId, callOpts);
    return await done();
  } catch (e) {
    const msg = (e as Error).message;
    // Already canceled (by hand, or by an earlier try whose answer was lost): nothing left to do.
    const status = isPaddleApiConfigured() ? await getSubscription(subscriptionId, callOpts).then((x) => x.status, () => null) : null;
    if (status === "canceled") return done().catch(() => false);
    console.error(`paddle: flagged subscription (${kind}) not canceled`, msg);
    await sql`
      update billing_flags set detail = ${cancelFailedDetail(kind, msg, converted)}, updated_at = now()
      where subscription_id = ${subscriptionId} and kind = ${kind}`.catch(() => {});
    return false;
  }
}

/**
 * Emails the customer that a duplicate plan was canceled, and that replying gets its charge
 * refunded (the owner refunds it in Paddle; see CANCEL_DETAIL.duplicate_subscription). Only to the
 * subscriber's own address. Never throws: the cancel itself is what matters.
 */
async function sendDuplicateNotice(subscriberId: number, subscriptionId: string): Promise<void> {
  try {
    const [s] = await sql<{ email: string }[]>`select email from subscribers where id = ${subscriberId}`;
    if (!s) return;
    const res = await sendEmail({ to: s.email, ...duplicatePlanEmail(), idempotencyKey: `duplicate-plan:${subscriptionId}` });
    if (!res.ok && !res.skipped) console.warn("duplicate plan note not sent", res.error);
  } catch (e) {
    console.warn("duplicate plan note not sent", (e as Error).message);
  }
}

/**
 * A trial canceled because its address wasn't confirmed in time doesn't use up the free trial,
 * and its confirmation link stops working, so a late click can't confirm the address for a plan
 * that no longer runs. A link the owner asked for themselves (a sign-up waiting in
 * pending_changes shares the token) keeps working.
 */
async function markUnconfirmedTrialCanceled(subscriptionId: string, db: Db = sql): Promise<void> {
  await db`
    update subscribers set
      unconfirmed_trial_sub = ${subscriptionId},
      confirm_token = case when status <> 'confirmed' and pending_changes is null then null else confirm_token end
    where paddle_subscription_id = ${subscriptionId}`;
}

type Target = { subscriberId: number; checkout: (CheckoutRow & { ref: string }) | null };
type Applied = { result: HandleResult; effects?: Effects };

/** The customer check made before the transaction, if it was for this subscriber. */
function customerFor(subscriberId: number, check: CustomerCheck | null, customerId: string | null): CustomerCheck {
  return check && check.subscriberId === subscriberId
    ? check
    : { subscriberId, customerId, status: customerId ? "unverified" : "none", reason: "not checked" };
}

/** A subscription held back earlier stays held back; a cancel that hasn't gone through is asked for again. */
async function stillHeld(tx: Tx, subId: string, status: BillingStatus): Promise<HandleResult | null> {
  const [held] = await tx<{ kind: BillingFlagKind; done: boolean }[]>`
    select kind, cancel_done_at is not null as done from billing_flags
    where subscription_id = ${subId} and kind in ('trial_blocked', 'duplicate_subscription', 'customer_mismatch')
      -- A cancel that hasn't gone through holds the subscription back even if its flag was marked dealt with.
      and (resolved_at is null or (kind <> 'customer_mismatch' and cancel_done_at is null))
    order by kind = 'customer_mismatch', kind limit 1`;
  if (!held) return null;
  const retry = !held.done && (held.kind === "trial_blocked" ? status === "trialing" : held.kind === "duplicate_subscription" && LIVE_STATUSES.includes(status));
  return { outcome: "flagged", ...(retry ? { cancel: { subscriptionId: subId, kind: held.kind as CancelKind } } : {}) };
}

async function customerMismatch(tx: Tx, subId: string, subscriberId: number, customer: CustomerCheck): Promise<HandleResult | null> {
  if (customer.status !== "mismatch") return null;
  await flag(tx, {
    subscriptionId: subId, kind: "customer_mismatch", subscriberId, customerId: customer.customerId,
    detail: "The Paddle customer's email is not this subscriber's address. The subscription was not linked and alerts stay off; cancel or refund it in Paddle if it shouldn't run.",
  });
  console.warn(`paddle webhook: customer of ${subId} doesn't match the subscriber; held back`);
  return { outcome: "flagged" };
}

/**
 * One running subscription per address: two checkouts finished at about the same time make two;
 * the one applied first stays. The row lock keeps two such events from both seeing no subscription.
 */
async function secondSubscription(tx: Tx, subId: string, subscriberId: number, status: BillingStatus, customerId: string | null): Promise<HandleResult | null> {
  if (!LIVE_STATUSES.includes(status)) return null;
  const [cur] = await tx<{ paddle_subscription_id: string | null; billing_status: BillingStatus }[]>`
    select paddle_subscription_id, billing_status from subscribers where id = ${subscriberId} for update`;
  if (!cur?.paddle_subscription_id || cur.paddle_subscription_id === subId || !LIVE_STATUSES.includes(cur.billing_status)) return null;
  await flag(tx, { subscriptionId: subId, kind: "duplicate_subscription", subscriberId, customerId, detail: CANCEL_DETAIL.duplicate_subscription.pending });
  console.warn(`paddle webhook: ${subId} is a second running subscription for one address; canceling`);
  return { outcome: "flagged", cancel: { subscriptionId: subId, kind: "duplicate_subscription" } };
}

/** One free trial per person: a trial the checkout didn't allow, or that this address already had, is canceled. */
async function trialNotAllowed(tx: Tx, subId: string, target: Target, status: BillingStatus, customerId: string | null): Promise<HandleResult | null> {
  if (status !== "trialing") return null;
  const [h] = await tx<(PlanHistory & { email: string })[]>`
    select email, confirmed_at, paddle_subscription_id, billing_status, trial_ends_at, canceled_at, unconfirmed_trial_sub from subscribers where id = ${target.subscriberId}`;
  if (!h || h.paddle_subscription_id === subId) return null;
  const notAllowed = target.checkout?.trial_allowed === false;
  if (!notAllowed && !hadTrialBefore(h, await trialUsedElsewhere(h.email, target.subscriberId, tx))) return null;
  await flag(tx, { subscriptionId: subId, kind: "trial_blocked", subscriberId: target.subscriberId, customerId, detail: CANCEL_DETAIL.trial_blocked.pending });
  console.warn(`paddle webhook: trial ${subId} not allowed for this address; canceling`);
  return { outcome: "flagged", cancel: { subscriptionId: subId, kind: "trial_blocked" } };
}

type WrittenRow = {
  prev_sub: string | null; prev_status: BillingStatus; prev_welcome: boolean;
  email: string; status: string; manage_token: string; unsubscribe_token: string; confirm_token: string | null;
  attribution: Record<string, string> | null; trial_ends_at: Date | null; plan_interval: PlanInterval | null;
};

/**
 * Applies the snapshot to the row in one statement. Skipped (null) when the event is older than
 * the last one applied for this subscription, or would replace a different subscription that
 * still runs. Emails are only claimed here (with a lease, *_claimed_at) and sent after the commit.
 */
async function writeSubscription(tx: Tx, sub: PaddleSubscription, b: BillingFields, occurredAt: string, target: Target, linkCustomer: string | null): Promise<WrittenRow | null> {
  const live = LIVE_STATUSES.includes(b.status);
  const alerts = ALERT_STATUSES.includes(b.status);
  const fallbackInterval: PlanInterval | null = target.checkout ? (target.checkout.plan === "quarterly" ? "quarter" : "month") : null;
  // Paying confirms the address only through a link that reached its mailbox: anyone can type an address into the public form.
  const paymentConfirms = live && Boolean(target.checkout?.address_proven);
  const [row] = await tx<WrittenRow[]>`
    with prev as (
      select id, paddle_subscription_id, billing_status,
             -- A returning customer's new plan gets its own welcome.
             (welcome_sent_at is not null and paddle_subscription_id = ${sub.id}) as welcome,
             paddle_subscription_id is distinct from ${sub.id} as new_sub,
             (${live}::boolean and paddle_subscription_id is distinct from ${sub.id}) as live_link,
             -- A plan that ended before its address was ever proven doesn't use up the owner's trial.
             (${b.status} = 'canceled' and awaiting_confirmation(subscribers)) as unproven_end,
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
      -- A different subscription must not inherit an earlier trial's end date.
      trial_ends_at = case when prev.new_sub then ${b.trialEndsAt}::timestamptz
                           else coalesce(${b.trialEndsAt}::timestamptz, s.trial_ends_at) end,
      current_period_end = ${b.currentPeriodEnd},
      canceled_at = ${b.canceledAt},
      cancel_at = ${b.cancelAt},
      billing_event_at = ${occurredAt},
      -- The plan is daily alerts (weekly stays a choice on the account page), and the first one
      -- is due with the next daily run (plan_started_at, see runAlerts).
      frequency = case when prev.live_link then 'daily' else s.frequency end,
      plan_started_at = case when prev.live_link then now() else s.plan_started_at end,
      unconfirmed_trial_sub = case when prev.unproven_end then ${sub.id} else s.unconfirmed_trial_sub end,
      status = prev.next_status,
      confirmed_at = case when prev.next_status = 'confirmed' then coalesce(s.confirmed_at, now()) else s.confirmed_at end,
      unsubscribed_at = case when prev.next_status = 'confirmed' then null else s.unsubscribed_at end,
      confirm_token = case when prev.next_status = 'confirmed' then null
                           when prev.live_link then coalesce(s.confirm_token, ${newToken()})
                           -- As in markUnconfirmedTrialCanceled: no late confirmation for a plan that no longer runs.
                           when prev.unproven_end and s.pending_changes is null then null
                           else s.confirm_token end,
      confirm_sent_at = case when prev.live_link and prev.next_status <> 'confirmed' then now() else s.confirm_sent_at end,
      confirm_claimed_at = case when prev.live_link and prev.next_status <> 'confirmed' then now() else s.confirm_claimed_at end,
      wants_alerts = case when ${live} then true else s.wants_alerts end,
      trial_reminder_sent_at = case when prev.new_sub then null else s.trial_reminder_sent_at end,
      trial_reminder_claimed_at = case when prev.new_sub then null else s.trial_reminder_claimed_at end,
      -- The daily job picks up a welcome claim older than its lease (welcomeSent ends it, welcomeNotSent gives it back).
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
           or prev.billing_status <> all(${LIVE_STATUSES}))
    returning prev.paddle_subscription_id as prev_sub, prev.billing_status as prev_status, prev.welcome as prev_welcome,
              s.email, s.status, s.manage_token, s.unsubscribe_token, s.confirm_token, s.attribution, s.trial_ends_at, s.plan_interval`;
  return row ?? null;
}

/** The customer: checked now (an earlier "couldn't check" flag is settled), or still to check. */
async function settleCustomerFlag(tx: Tx, subId: string, customer: CustomerCheck, linkCustomer: string | null): Promise<void> {
  if (linkCustomer) {
    await tx`update billing_flags set resolved_at = now(), updated_at = now() where subscription_id = ${subId} and kind = 'customer_unverified' and resolved_at is null`;
  } else if (customer.status === "unverified" && customer.customerId) {
    await flag(tx, {
      subscriptionId: subId, kind: "customer_unverified", subscriberId: customer.subscriberId, customerId: customer.customerId,
      detail: `The Paddle customer couldn't be checked against the address (${customer.reason ?? "unknown"}), so it isn't linked yet. It is checked again with the next event or when billing is opened.`,
    });
  }
}

/** Marks the checkout as used, and adds the search picked at checkout to a newly running plan. */
async function linkCheckout(tx: Tx, subId: string, target: Target, newlyLive: boolean): Promise<void> {
  if (!target.checkout) return;
  await tx`update paddle_checkouts set subscription_id = ${subId} where ref = ${target.checkout.ref}`;
  if (!newlyLive) return;
  const search = target.checkout.search ?? "";
  // In a savepoint: a failure here (e.g. the 5-search limit) must not undo the event.
  await tx.savepoint((sp) => addSavedSearch(target.subscriberId, search, sp))
    .catch((e: Error) => console.warn("paddle webhook: saved search not added", (e as Error).message));
}

/** The Admin → Overview error for a running Paddle subscription that matches no subscriber (no personal data: the subscription id only). */
export function unmatchedLiveMessage(subscriptionId: string, status: BillingStatus): string {
  return `Paddle subscription ${subscriptionId} is running (${status}) but matches no subscriber here, so nobody gets alerts for it. Check it in Paddle and cancel or refund it if it shouldn't run.`;
}

async function applySubscription(tx: Tx, sub: PaddleSubscription, occurredAt: string, check: CustomerCheck | null): Promise<Applied> {
  if (typeof sub?.id !== "string" || !SUB_ID_RE.test(sub.id)) return { result: { outcome: "ignored" } };
  const target = await findSubscriber(tx, sub);
  if (!target) {
    // E.g. a simulated event, or a subscription created outside this site.
    console.warn(`paddle webhook: no subscriber for ${sub.id}`);
    // A running one may charge someone who gets nothing here: shown on Admin → Overview (the id only).
    const status = billingFromSubscription(sub).status;
    if (LIVE_STATUSES.includes(status)) {
      await recordOpsEvent("webhook", unmatchedLiveMessage(sub.id, status));
    }
    return { result: { outcome: "unmatched" } };
  }
  const b = billingFromSubscription(sub);
  if (b.status === "none") return { result: { outcome: "ignored" } };

  const customerId = isPaddleCustomerId(sub.customer_id) ? sub.customer_id : null;
  const customer = customerFor(target.subscriberId, check, customerId);
  const held = (await stillHeld(tx, sub.id, b.status))
    ?? (await customerMismatch(tx, sub.id, target.subscriberId, customer))
    ?? (await secondSubscription(tx, sub.id, target.subscriberId, b.status, customerId))
    ?? (await trialNotAllowed(tx, sub.id, target, b.status, customerId));
  if (held) return { result: held };

  // Only a customer whose email is this address is linked (portal sessions open for it).
  const linkCustomer = customer.status === "verified" ? customer.customerId : null;
  const row = await writeSubscription(tx, sub, b, occurredAt, target, linkCustomer);
  if (!row) return { result: { outcome: "stale" } };
  await settleCustomerFlag(tx, sub.id, customer, linkCustomer);
  await linkCheckout(tx, sub.id, target, LIVE_STATUSES.includes(b.status) && row.prev_sub !== sub.id);

  const fx = transitionEffects({ subscriptionId: row.prev_sub, status: row.prev_status, welcomeSent: row.prev_welcome }, { subscriptionId: sub.id, status: b.status, confirmed: row.status === "confirmed" });
  const props = { plan: row.plan_interval, ...(row.attribution ? { campaign: row.attribution } : {}) };
  const trialEndsAt = welcomeTrialEnd(b.status, row.trial_ends_at);
  return {
    result: {
      outcome: "applied",
      welcome: fx.sendWelcome
        ? { subscriberId: target.subscriberId, subscriptionId: sub.id, email: row.email, manageToken: row.manage_token, unsubscribeToken: row.unsubscribe_token, trialEndsAt, planInterval: row.plan_interval }
        : undefined,
      confirm: fx.askConfirm && row.confirm_token
        ? { subscriberId: target.subscriberId, email: row.email, confirmToken: row.confirm_token, subscriptionId: sub.id, manageToken: row.manage_token, trialEndsAt, planInterval: row.plan_interval, sendDay: "start" }
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

export type PendingCancel = { subscription_id: string; kind: CancelKind; converted: boolean };

/**
 * Cancels the daily job still retries: every blocked trial or second subscription whose cancel
 * Paddle hasn't confirmed (cancel_done_at), and every unconfirmed trial's failed cancel while the
 * address stays unconfirmed and the subscription still runs. Whether the flag was marked dealt
 * with (resolved_at) doesn't matter: only a cancel that went through ends the retries, so the
 * admin offers "Mark dealt with" for these flags only once this list no longer has them.
 * only: limit the answer to these subscriptions (the admin's list).
 */
export async function pendingCancels(opts: { exclude?: string[]; only?: string[]; limit?: number } = {}): Promise<PendingCancel[]> {
  const { exclude = [], only = null, limit = 200 } = opts;
  return sql<PendingCancel[]>`
    select subscription_id, kind, converted from (
      select f.subscription_id, f.kind, false as converted, f.updated_at from billing_flags f
      where f.kind in ('trial_blocked', 'duplicate_subscription') and f.cancel_done_at is null
      union all
      select f.subscription_id, f.kind, s.billing_status <> 'trialing' as converted, f.updated_at
      from billing_flags f join subscribers s on s.paddle_subscription_id = f.subscription_id
      where f.kind = 'trial_unconfirmed' and f.cancel_done_at is null
        and awaiting_confirmation(s) and s.billing_status = any(${LIVE_STATUSES})
    ) p
    where p.subscription_id <> all(${exclude}::text[])
      and (${only}::text[] is null or p.subscription_id = any(${only}::text[]))
    order by p.updated_at limit ${limit}`;
}

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
 * Daily job, before the plan emails: cancels trials still awaiting confirmation
 * (awaiting_confirmation(), migration 017) before they can charge, retries
 * cancels that failed, and re-checks Paddle customers that couldn't be checked.
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
  const triedNow = ending.map((r) => r.sub);

  // 2. Cancels that didn't go through earlier: asked for by the webhook (blocked trials, second
  // subscriptions), or an unconfirmed trial's cancel that failed (step 1 only looks at trials still
  // in their trial). The latter is retried while the address stays unconfirmed and the
  // subscription still runs, in any running status: a trial that turned into a paid plan
  // meanwhile is canceled at once, and its flag says the payment must be refunded.
  const cancelRetries = { canceled: 0, failed: 0 };
  const pending = await pendingCancels({ exclude: triedNow, limit });
  for (const f of pending) {
    if (await cancelFlaggedSubscription(f.subscription_id, f.kind, { converted: f.converted })) cancelRetries.canceled++;
    else cancelRetries.failed++;
  }
  // Unconfirmed-trial cancels that are no longer retried say why: the owner confirmed the address
  // (nothing to do), or the subscription stopped running here first (check for a payment to refund).
  await sql`
    update billing_flags f set
      detail = case when s.id is not null and not awaiting_confirmation(s) then ${UNCONFIRMED_DETAIL.confirmed} else ${UNCONFIRMED_DETAIL.ended} end,
      resolved_at = case when s.id is not null and not awaiting_confirmation(s) then now() else null end,
      updated_at = now()
    from billing_flags f0 left join subscribers s on s.paddle_subscription_id = f0.subscription_id
    where f.subscription_id = f0.subscription_id and f.kind = f0.kind
      and f.kind = 'trial_unconfirmed' and f.resolved_at is null and f.cancel_done_at is null
      and not (s.id is not null and awaiting_confirmation(s) and s.billing_status = any(${LIVE_STATUSES}))
      and f.detail is distinct from (case when s.id is not null and not awaiting_confirmation(s) then ${UNCONFIRMED_DETAIL.confirmed} else ${UNCONFIRMED_DETAIL.ended} end)`;

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
 * opts: the Paddle time limits (a visitor is waiting: userPaddleBudget()).
 */
export async function verifiedCustomerFor(s: BillingTarget, opts: PaddleCallOptions = {}): Promise<string | null> {
  if (s.paddle_customer_id && s.paddle_customer_verified_at) return s.paddle_customer_id;
  if (!isPaddleApiConfigured()) return null;
  let customerId = s.paddle_customer_id;
  if (!customerId && s.paddle_subscription_id && SUB_ID_RE.test(s.paddle_subscription_id)) {
    customerId = await getSubscription(s.paddle_subscription_id, opts).then((x) => x.customer_id, () => null);
  }
  if (!isPaddleCustomerId(customerId)) return null;
  const v = await verifyCustomerEmail(customerId, s.email, opts);
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
