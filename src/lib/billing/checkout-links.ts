/**
 * Checkout for addresses that have or had a plan (server only).
 *
 * The public trial form must not tell whoever typed an address that it is (or
 * was) a customer. So for those addresses the form only says "check your
 * inbox", and the next step goes to the address itself:
 *  - a plan is running: the account link ("You already have daily alerts");
 *  - a plan was had before: a single-use link, valid 24 hours, to
 *    /account/continue, which shows the terms for this address (no second
 *    free trial: one per email address) and opens Paddle Checkout for a
 *    transaction without a trial.
 * The reply on the page is the same in both cases, and the same when the
 * daily cap stops the email.
 */
import { createHash, randomBytes } from "node:crypto";
import { sendAccountLink } from "@/lib/account";
import { createNoTrialTransaction, isPaddleApiConfigured } from "@/lib/billing/paddle";
import {
  CHECKOUT_UNAVAILABLE, hadTrialBefore, LIVE_STATUSES, priceIdFor, TOKEN_RE,
  type CheckoutPlan, type PlanHistory, type StartCheckoutResult,
} from "@/lib/billing/subscriptions";
import { hasTrialMarker } from "@/lib/billing/trial-markers";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { checkoutLinkEmail } from "@/lib/email-templates";
import { takeDailyQuota } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/site";

/** How long an emailed checkout link works. */
export const CHECKOUT_LINK_HOURS = 24;
/** At most this many checkout emails per address in any 24 hours (like the account link). */
export const CHECKOUT_LINKS_PER_DAY = 5;

/** The one reply the trial form gives for an address that has or had a plan. */
export const CHECK_INBOX = "Check your inbox: we've emailed this address a link to continue.";

export type CheckoutState =
  | { status: "idle" | "error"; message: string }
  /** trial: false only on the continue page; the browser then opens Paddle Checkout for transactionId (the plan without its trial). */
  | { status: "ready"; message: string; ref: string; email: string; plan: CheckoutPlan; trial: boolean; transactionId: string | null }
  /** The address has or had a plan: the same reply either way; the next step was emailed. */
  | { status: "inbox"; message: string };

/** What the trial form shows for startCheckout's result. Pure, so it is unit-tested. */
export function checkoutReply(res: StartCheckoutResult, plan: CheckoutPlan): CheckoutState {
  if (!res.ok) return { status: "error", message: res.error };
  if ("inbox" in res) return { status: "inbox", message: CHECK_INBOX };
  return { status: "ready", message: "", ref: res.ref, email: res.email, plan, trial: true, transactionId: null };
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");

export const continueUrl = (token: string) => absoluteUrl(`/account/continue?token=${token}`);

/** A new single-use checkout link for this subscriber; returns its token (only the hash is stored). */
export async function createCheckoutLink(subscriberId: number, opts: { plan: CheckoutPlan; search: string | null; visitor?: string | null }): Promise<string> {
  const token = newToken();
  await sql`
    insert into checkout_links (token_hash, subscriber_id, plan, search, visitor, expires_at)
    values (${hashToken(token)}, ${subscriberId}, ${opts.plan}, ${opts.search}, ${opts.visitor ?? null}, now() + make_interval(hours => ${CHECKOUT_LINK_HOURS}))`;
  return token;
}

/**
 * Emails the next step to an address startCheckout answered with `inbox`. Never
 * throws for a send that failed (the caller's reply doesn't change). Returns
 * whether an email went out.
 */
export async function sendCheckoutLink(
  target: { subscriberId: number; email: string; live: boolean },
  opts: { plan: CheckoutPlan; search: string | null; visitor?: string | null },
): Promise<boolean> {
  if (isEmailConfigured() && !(await takeDailyQuota(`checkout-link-day|${target.email}`, CHECKOUT_LINKS_PER_DAY))) {
    console.info("checkout link: daily limit reached for this address"); // the address itself is never logged
    return false;
  }
  // A plan is running: nothing to buy; the account link, worded for it.
  if (target.live) return sendAccountLink(target.email, "already");
  const token = await createCheckoutLink(target.subscriberId, opts);
  const res = await sendEmail({
    to: target.email,
    ...checkoutLinkEmail({ continueUrl: continueUrl(token), hours: CHECKOUT_LINK_HOURS }),
    idempotencyKey: `checkout-link:${target.subscriberId}:${hashToken(token).slice(0, 16)}`,
  });
  if (!res.ok) {
    // Not sent: the link would never be used.
    await sql`delete from checkout_links where token_hash = ${hashToken(token)}`.catch(() => {});
    if (!res.skipped) console.warn("checkout link not sent", res.error);
  }
  return res.ok;
}

/**
 * What the continue page offers for this address now: "live" (a plan is
 * running), "returning" (had a plan: no trial) or "new" (never had one: the
 * trial, e.g. after its trial marker expired).
 */
export type LinkState = "live" | "returning" | "new";

async function stateOf(subscriberId: number): Promise<{ email: string; state: LinkState } | null> {
  const [s] = await sql<(PlanHistory & { email: string })[]>`
    select email, paddle_subscription_id, billing_status, trial_ends_at, canceled_at from subscribers where id = ${subscriberId}`;
  if (!s) return null;
  const state: LinkState = LIVE_STATUSES.includes(s.billing_status) ? "live" : hadTrialBefore(s, await hasTrialMarker(s.email)) ? "returning" : "new";
  return { email: s.email, state };
}

export type CheckoutLink = { email: string; plan: CheckoutPlan; state: LinkState };

/** The link behind a token, if it is unused and unexpired (looking doesn't use it up). */
export async function findCheckoutLink(token: unknown): Promise<CheckoutLink | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const [link] = await sql<{ subscriber_id: number; plan: CheckoutPlan }[]>`
    select subscriber_id::int as subscriber_id, plan from checkout_links
    where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()`;
  if (!link) return null;
  const st = await stateOf(link.subscriber_id);
  return st ? { email: st.email, plan: link.plan, state: st.state } : null;
}

export type ContinueResult =
  | { ok: true; ref: string; email: string; trial: boolean; transactionId: string | null }
  | { ok: false; error: string; used?: boolean };

export const LINK_USED = "This link has already been used or has expired. Start again from the free trial page and we'll email you a new one.";

/**
 * The continue page's button: uses the link up (single use), then prepares
 * the checkout with the right terms for the address. A returning customer
 * gets a Paddle transaction for the plan without its trial; if that can't be
 * created, the link is given back so the visitor can try again, and the trial
 * is never offered instead. Opening the link proves the address is the
 * visitor's, so paying confirms it (new_subscriber on the checkout).
 */
export async function continueCheckout(token: unknown, plan: CheckoutPlan): Promise<ContinueResult> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, error: LINK_USED, used: true };
  const hash = hashToken(token);
  const [link] = await sql<{ subscriber_id: number; search: string | null; visitor: string | null }[]>`
    update checkout_links set used_at = now()
    where token_hash = ${hash} and used_at is null and expires_at > now()
    returning subscriber_id::int as subscriber_id, search, visitor`;
  if (!link) return { ok: false, error: LINK_USED, used: true };
  const giveBack = () => sql`update checkout_links set used_at = null where token_hash = ${hash}`.catch(() => {});
  const st = await stateOf(link.subscriber_id);
  if (!st) return { ok: false, error: LINK_USED, used: true };
  if (st.state === "live") return { ok: false, error: "This address already has daily alerts. Open your account from the link in any of our emails." };

  const ref = newToken();
  let transactionId: string | null = null;
  if (st.state === "returning") {
    try {
      if (!isPaddleApiConfigured()) throw new Error("PADDLE_API_KEY is not set");
      transactionId = await createNoTrialTransaction(priceIdFor(plan), { ref });
    } catch (e) {
      console.error("no-trial checkout failed", (e as Error).message);
      await giveBack();
      return { ok: false, error: CHECKOUT_UNAVAILABLE };
    }
  }
  await sql`
    insert into paddle_checkouts (ref, subscriber_id, plan, search, new_subscriber, visitor, trial_allowed)
    values (${ref}, ${link.subscriber_id}, ${plan}, ${link.search}, true, ${link.visitor}, ${transactionId === null})`;
  return { ok: true, ref, email: st.email, trial: transactionId === null, transactionId };
}
