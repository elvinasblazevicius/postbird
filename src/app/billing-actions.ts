"use server";

/**
 * Server actions for paid daily alerts: starting a Paddle checkout and the
 * account page. Only used when billing is live (src/lib/billing/live.ts).
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { after } from "next/server";
import { cleanCampaign, visitorFromHeaders } from "@/lib/analytics";
import { parseMetaMatch, sendCapiEvent } from "@/lib/meta-capi";
import { planPriceNumber } from "@/lib/early-access-copy";
import { accountUrl, findByManageToken, sendAccountLink } from "@/lib/account";
import { BILLING_LIVE } from "@/lib/billing/live";
import { checkoutReply, continueCheckout, createCheckoutLink, sendCheckoutLink, type CheckoutState } from "@/lib/billing/checkout-links";
import { planRenewal } from "@/lib/billing/notices";
import { renewalAcknowledged, RENEWAL_ACK_REQUIRED } from "@/lib/billing/renewal-consent";
import { createPortalSession, isPaddleApiConfigured, userPaddleBudget } from "@/lib/billing/paddle";
import { checkoutAccountToken, LIVE_STATUSES, startCheckout, verifiedCustomerFor, type BillingTarget, type CheckoutPlan } from "@/lib/billing/subscriptions";
import { sql } from "@/lib/db";
import { clientIp, rateLimit, safeRateLimit } from "@/lib/rate-limit";
import { addSavedSearch, normalizeSearch, removeSavedSearch, searchFromSignupForm } from "@/lib/saved-searches";
import { findByUnsubscribeToken, normalizeEmail } from "@/lib/subscribers";
import { filtersFromQuery, jobsUrl } from "@/lib/jobs";
import { parseId, siteConfig } from "@/lib/site";
import type { FormState } from "@/app/actions";

export type { CheckoutState };

const SERVER_ERROR = "Something went wrong on our side. Please try again in a minute.";

const planFrom = (form: FormData): CheckoutPlan | null => {
  const raw = String(form.get("plan") ?? "");
  return raw === "monthly" || raw === "quarterly" ? raw : null;
};

/**
 * Validates the trial form and prepares the subscriber; the browser then opens
 * Paddle Checkout with the trial. A confirmed address, or one that has or had
 * a plan, gets the same "check your inbox" reply either way, and its next step
 * by email (sent after the response, so the reply takes as long as for anyone else).
 */
export async function startCheckoutAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  if (!BILLING_LIVE) return { status: "error", message: "Daily alerts aren't open yet." };
  // Honeypot: real visitors never fill this hidden field. Pretend nothing happened.
  if (String(form.get("website") ?? "")) return { status: "idle", message: "" };
  const h = await headers();
  const limit = await safeRateLimit(`checkout:${clientIp(h)}`, 8, 3600);
  if (limit === "error") return { status: "error", message: SERVER_ERROR };
  if (limit === "limited") {
    return { status: "error", message: "Too many attempts from this connection. Please try again in an hour." };
  }
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { status: "error", message: "Enter a valid email address." };
  const plan = planFrom(form);
  if (!plan) return { status: "error", message: "Choose a plan." };
  if (!renewalAcknowledged(form)) return { status: "error", message: RENEWAL_ACK_REQUIRED };
  // The saved search: a search started on the jobs page, with the form's "What should we watch for?" answers.
  const search = searchFromSignupForm(form);
  let attribution: Record<string, string> | null = null;
  try {
    attribution = cleanCampaign(JSON.parse(String(form.get("attribution") || "null")));
  } catch {
    attribution = null;
  }
  try {
    const visitor = visitorFromHeaders(h);
    const res = await startCheckout({ email, plan, search: search || null, source: String(form.get("source") ?? "").slice(0, 40) || undefined, attribution, visitor, renewalConsent: true });
    if (res.ok && "inbox" in res) {
      // Per address too (like the account link), so nobody can flood someone's inbox from many connections.
      if (await rateLimit(`checkout-link:${res.email}`, 3, 3600)) {
        const target = { subscriberId: res.subscriberId, email: res.email, live: res.live };
        after(async () => {
          await sendCheckoutLink(target, { plan, search: search || null, visitor }).catch((e: Error) => console.error("checkout link failed", e.message));
        });
      }
    }
    return checkoutReply(res, plan);
  } catch (e) {
    console.error("checkout start failed", (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
}

/**
 * The button on /account/continue (the emailed checkout link): uses the link
 * up and prepares the checkout with the terms shown on that page.
 */
export async function continueCheckoutAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  if (!BILLING_LIVE) return { status: "error", message: "Daily alerts aren't open yet." };
  const plan = planFrom(form);
  if (!plan) return { status: "error", message: "Choose a plan." };
  if (!renewalAcknowledged(form)) return { status: "error", message: RENEWAL_ACK_REQUIRED };
  const h = await headers();
  const limit = await safeRateLimit(`checkout:${clientIp(h)}`, 8, 3600);
  if (limit === "error") return { status: "error", message: SERVER_ERROR };
  if (limit === "limited") {
    return { status: "error", message: "Too many attempts from this connection. Please try again in an hour." };
  }
  try {
    const res = await continueCheckout(form.get("token"), plan, { renewalConsent: true });
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "ready", message: "", ref: res.ref, email: res.email, plan, trial: res.trial, transactionId: res.transactionId, confirmFirst: false };
  } catch (e) {
    console.error("checkout continue failed", (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
}

/**
 * Called by the browser after Paddle reports the checkout complete. Returns
 * the account link once the webhook has linked the subscription, and only for
 * a checkout that created the account; otherwise null (the link is emailed).
 */
export async function checkoutDoneAction(ref: string): Promise<{ linked: boolean; accountUrl: string | null }> {
  if (typeof ref !== "string") return { linked: false, accountUrl: null };
  const h = await headers();
  if ((await safeRateLimit(`checkout-done:${clientIp(h)}`, 40, 3600)) !== "ok") return { linked: false, accountUrl: null };
  const res = await checkoutAccountToken(ref).catch(() => ({ linked: false, manageToken: null }));
  return { linked: res.linked, accountUrl: res.manageToken ? accountUrl(res.manageToken) : null };
}

/**
 * After Paddle's checkout completed in the browser: the same StartTrial or Purchase the pixel
 * reports, sent from the server (Conversions API), for a checkout started here in the last two
 * hours (`ref`), and only with advertising consent (`meta`, from metaMatchValue in ads.tsx).
 */
export async function metaCheckoutAction(ref: string, trial: boolean, meta: string): Promise<void> {
  if (typeof ref !== "string" || ref.length > 100) return;
  const match = parseMetaMatch(meta);
  if (!match) return;
  const h = await headers();
  if ((await safeRateLimit(`meta-checkout:${clientIp(h)}`, 20, 3600)) !== "ok") return;
  const [row] = await sql<{ email: string; plan: string }[]>`
    select s.email, c.plan from paddle_checkouts c join subscribers s on s.id = c.subscriber_id
     where c.ref = ${ref} and c.created_at > now() - interval '2 hours'`.catch(() => []);
  if (!row) return;
  const ip = clientIp(h);
  const ua = h.get("user-agent");
  await sendCapiEvent(trial
    ? { event: "StartTrial", match, email: row.email, ip, ua }
    : { event: "Purchase", match, email: row.email, ip, ua, value: planPriceNumber(row.plan === "quarterly" ? "quarter" : "month"), currency: "USD" });
}

// ── Account page ─────────────────────────────────────────────

const INVALID_LINK: FormState = { status: "error", message: "This account link isn't valid any more. Ask for a new one below." };

async function accountFrom(form: FormData) {
  return findByManageToken(String(form.get("t") ?? ""));
}

/** A lookup that reads the database: "error" (logged) instead of throwing, so the form can say so. */
function orError<T>(name: string, p: Promise<T>): Promise<T | "error"> {
  return p.catch((e: Error) => {
    console.error(`${name} failed`, e.message);
    return "error" as const;
  });
}

/** Adds a saved search, from a pasted /jobs link or from the filter fields. */
export async function addSearchAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await orError("add search", accountFrom(form));
  if (acct === "error") return { status: "error", message: SERVER_ERROR };
  if (!acct) return INVALID_LINK;
  let search: string | null;
  const pasted = String(form.get("link") ?? "").trim();
  if (pasted) {
    search = normalizeSearch(pasted);
    if (search === null) return { status: "error", message: "That doesn't look like a search link from our jobs page. Run a search on Jobs, then copy the address from your browser." };
  } else {
    // Every field the account search builder offers; org, where and grade may repeat.
    const params = new URLSearchParams();
    for (const k of ["q", "where", "org", "category", "grade", "type", "lang", "exp", "remote", "hidelocal"]) {
      for (const raw of form.getAll(k).slice(0, 10)) {
        const v = String(raw ?? "").trim().slice(0, 120);
        if (v) params.append(k, v);
      }
    }
    search = jobsUrl({ ...filtersFromQuery(params.toString()), page: undefined, sort: undefined, posted: undefined }).replace(/^\/jobs\??/, "");
  }
  try {
    const res = await addSavedSearch(acct.id, search);
    if (!res.ok) return { status: "error", message: res.error };
    refresh();
    return { status: "success", message: res.added ? "Search saved. New matches come with your next alert." : "You already have this search." };
  } catch (e) {
    console.error("add search failed", (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
}

/**
 * Runs an account-page action: a database error becomes the usual "something went wrong" reply
 * instead of an error page. (Nothing that redirects runs inside it.)
 */
async function guarded(name: string, fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (e) {
    console.error(`${name} failed`, (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
}

export async function removeSearchAction(_prev: FormState, form: FormData): Promise<FormState> {
  return guarded("remove search", async () => {
    const acct = await accountFrom(form);
    if (!acct) return INVALID_LINK;
    const id = parseId(form.get("id"));
    if (id === null) return { status: "error", message: "Unknown search." };
    await removeSavedSearch(acct.id, id);
    refresh();
    return { status: "success", message: "Search removed." };
  });
}

export async function frequencyAction(_prev: FormState, form: FormData): Promise<FormState> {
  return guarded("frequency", async () => {
    const acct = await accountFrom(form);
    if (!acct) return INVALID_LINK;
    const f = String(form.get("frequency") ?? "");
    if (f !== "daily" && f !== "weekly") return { status: "error", message: "Choose daily or weekly." };
    await sql`update subscribers set frequency = ${f} where id = ${acct.id}`;
    refresh();
    return { status: "success", message: f === "daily" ? "You'll get at most one email a day." : "You'll get at most one email a week." };
  });
}

/** Stops all emails. A Paddle subscription keeps running until it is canceled in billing. */
export async function accountUnsubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  return guarded("account unsubscribe", async () => {
    const acct = await accountFrom(form);
    if (!acct) return INVALID_LINK;
    await sql`
      update subscribers set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null, pending_changes = null
      where id = ${acct.id} and status <> 'unsubscribed'`;
    refresh();
    // Unsubscribing stops alerts, not payments: say so when the plan still charges.
    const renewal = planRenewal(acct);
    if (renewal?.chargesAhead) {
      return { status: "success", message: `You're unsubscribed from alerts. ${renewal.sentence} To stop payments, use “Cancel plan”.` };
    }
    return { status: "success", message: "You're unsubscribed. We won't email you again." };
  });
}

/** Turns emails back on (the account link proves the address is theirs). */
export async function resubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  return guarded("resubscribe", async () => {
    const acct = await accountFrom(form);
    if (!acct) return INVALID_LINK;
    await sql`
      update subscribers set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), unsubscribed_at = null, wants_alerts = true
      where id = ${acct.id}`;
    refresh();
    return { status: "success", message: "Emails are back on." };
  });
}

/**
 * Opens a fresh Paddle customer portal session (rate-limited per connection),
 * only for a Paddle customer whose email is this subscriber's address.
 */
async function openPortal(target: BillingTarget): Promise<FormState> {
  if (!target.paddle_customer_id && !target.paddle_subscription_id) return { status: "error", message: "There's no billing account for this address yet." };
  if (!isPaddleApiConfigured()) return { status: "error", message: "Billing management isn't available right now. Please email us and we'll help." };
  const h = await headers();
  const limit = await safeRateLimit(`portal:${clientIp(h)}`, 20, 3600);
  if (limit === "error") return { status: "error", message: "We couldn't open billing just now. Please try again in a minute." };
  if (limit === "limited") return { status: "error", message: "Too many attempts. Please try again later." };
  let url: string;
  try {
    // One time budget for every Paddle call below (at most ~3 s each, 7 s in all): the visitor is waiting.
    const budget = userPaddleBudget();
    const customerId = await verifiedCustomerFor(target, budget);
    if (!customerId) {
      const mail = siteConfig.contactEmail;
      return { status: "error", message: `We couldn't open billing for this address. Please email us${mail ? ` at ${mail}` : ""} and we'll help.` };
    }
    url = await createPortalSession(customerId, target.paddle_subscription_id, budget);
  } catch (e) {
    console.error("portal session failed", (e as Error).message);
    return { status: "error", message: "We couldn't open billing just now. Please try again in a minute." };
  }
  redirect(url); // outside try: redirect() works by throwing
}

/** "Manage billing": sends the customer to a fresh Paddle customer portal session (its overview). "Cancel plan" is ./cancel-actions.ts. */
export async function portalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await orError("portal", accountFrom(form));
  if (acct === "error") return { status: "error", message: SERVER_ERROR };
  if (!acct) return INVALID_LINK;
  return openPortal(acct);
}

/**
 * "Start your free trial" / "Restart daily alerts" on the account page. The account link only
 * ever reaches the address, so it proves it: straight to the continue page, which offers the
 * trial or not (one per person), instead of the public form and an extra email round trip.
 */
export async function restartPlanAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!BILLING_LIVE) return { status: "error", message: "Daily alerts aren't open yet." };
  let target: string;
  try {
    const acct = await accountFrom(form);
    if (!acct) return INVALID_LINK;
    if (LIVE_STATUSES.includes(acct.billing_status)) return { status: "error", message: "You already have daily alerts." };
    target = `/account/continue?token=${await createCheckoutLink(acct.id, { plan: "quarterly", search: null })}`;
  } catch (e) {
    console.error("restart plan failed", (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
  redirect(target); // outside try: redirect() works by throwing
}

/**
 * "Cancel my plan" on the unsubscribe page. Its token is the unsubscribe
 * link's, which is in every email and never changes, so it doesn't open
 * billing itself: it emails the account link, worded for cancelling.
 */
export async function unsubscribeCancelLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  const sub = await orError("cancel link", findByUnsubscribeToken(form.get("token")));
  if (sub === "error") return { status: "error", message: SERVER_ERROR };
  if (!sub) return { status: "error", message: "This link isn't valid any more. Use the link in your latest email from us." };
  const h = await headers();
  const limit = await safeRateLimit(`account-login:${clientIp(h)}`, 5, 3600);
  if (limit === "error") return { status: "error", message: SERVER_ERROR };
  if (limit === "limited") {
    return { status: "error", message: "Too many requests from this connection. Please try again in an hour." };
  }
  try {
    // Sent after the response, like the account link below, so the reply always takes as long.
    if (await rateLimit(`account-link:${sub.email}`, 3, 3600)) {
      const email = sub.email;
      after(async () => {
        await sendAccountLink(email, "cancel").catch((e: Error) => console.error("cancel link failed", e.message));
      });
    }
  } catch (e) {
    console.error("cancel link failed", (e as Error).message);
  }
  return { status: "success", message: "We've emailed you a link to cancel your plan." };
}

const LOGIN_MESSAGE = "If this address has an account with us, we've emailed it the link. It can take a minute or two to arrive; check your spam folder too.";

/**
 * "Email me my account link" (also "Email me a link to cancel"). Always the same answer, so it
 * can't tell anyone who is subscribed. Only the rate limits are awaited: the lookup and the send
 * run after the response (after()), so the reply takes as long whether or not the address has an
 * account (as in startCheckoutAction).
 */
export async function accountLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (String(form.get("website") ?? "")) return { status: "success", message: LOGIN_MESSAGE };
  const h = await headers();
  const limit = await safeRateLimit(`account-login:${clientIp(h)}`, 5, 3600);
  if (limit === "error") return { status: "error", message: SERVER_ERROR };
  if (limit === "limited") {
    return { status: "error", message: "Too many requests from this connection. Please try again in an hour." };
  }
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { status: "error", message: "Enter a valid email address." };
  const purpose = form.get("intent") === "cancel" ? "cancel" : "manage";
  try {
    // Per address too, so nobody can flood someone's inbox from many connections.
    if (await rateLimit(`account-link:${email}`, 3, 3600)) {
      after(async () => {
        await sendAccountLink(email, purpose).catch((e: Error) => console.error("account link failed", e.message));
      });
    }
  } catch (e) {
    console.error("account link failed", (e as Error).message);
  }
  return { status: "success", message: LOGIN_MESSAGE };
}
