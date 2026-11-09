"use server";

/**
 * Server actions for paid email alerts: starting a Paddle checkout and the
 * account page. Only used when billing is live (src/lib/billing/live.ts).
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { cleanCampaign, visitorFromHeaders } from "@/lib/analytics";
import { accountUrl, findByManageToken, sendAccountLink } from "@/lib/account";
import { BILLING_LIVE } from "@/lib/billing/live";
import { createPortalSession, isPaddleApiConfigured } from "@/lib/billing/paddle";
import { checkoutAccountToken, startCheckout, type CheckoutPlan } from "@/lib/billing/subscriptions";
import { sql } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { addSavedSearch, normalizeSearch, removeSavedSearch } from "@/lib/saved-searches";
import { normalizeEmail } from "@/lib/subscribers";
import { jobsUrl, parseFilters } from "@/lib/jobs";
import type { FormState } from "@/app/actions";

export type CheckoutState =
  | { status: "idle" | "error"; message: string }
  | { status: "ready"; message: string; ref: string; email: string; plan: CheckoutPlan }
  | { status: "already"; message: string };

const SERVER_ERROR = "Something went wrong on our side. Please try again in a minute.";

/** Validates the trial form and prepares the subscriber; the browser then opens Paddle Checkout. */
export async function startCheckoutAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  if (!BILLING_LIVE) return { status: "error", message: "Email alerts aren't open yet." };
  // Honeypot: real visitors never fill this hidden field. Pretend nothing happened.
  if (String(form.get("website") ?? "")) return { status: "idle", message: "" };
  const h = await headers();
  if (!(await rateLimit(`checkout:${clientIp(h)}`, 8, 3600))) {
    return { status: "error", message: "Too many attempts from this connection. Please try again in an hour." };
  }
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { status: "error", message: "Enter a valid email address." };
  const planRaw = String(form.get("plan") ?? "");
  if (planRaw !== "monthly" && planRaw !== "quarterly") return { status: "error", message: "Choose a plan." };
  const plan: CheckoutPlan = planRaw;
  // The saved search (the /jobs query string) when the trial was started from a search; same rule as signupAction.
  const rawSearch = String(form.get("search") ?? "");
  const search = rawSearch && rawSearch.length <= 400 && /^[\w%=&+.,~-]*$/.test(rawSearch) ? normalizeSearch(rawSearch) : null;
  let attribution: Record<string, string> | null = null;
  try {
    attribution = cleanCampaign(JSON.parse(String(form.get("attribution") || "null")));
  } catch {
    attribution = null;
  }
  try {
    const res = await startCheckout({
      email,
      plan,
      search: search || null,
      source: String(form.get("source") ?? "").slice(0, 40) || undefined,
      attribution,
      visitor: visitorFromHeaders(h),
    });
    if (!res.ok) return { status: "error", message: res.error };
    if ("alreadySubscribed" in res) {
      if (await rateLimit(`account-link:${res.email}`, 3, 3600)) await sendAccountLink(res.email);
      return { status: "already", message: "This address already has email alerts. We've emailed you the link to your account, where you can add searches or manage billing." };
    }
    return { status: "ready", message: "", ref: res.ref, email: res.email, plan };
  } catch (e) {
    console.error("checkout start failed", (e as Error).message);
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
  if (!(await rateLimit(`checkout-done:${clientIp(h)}`, 40, 3600))) return { linked: false, accountUrl: null };
  const res = await checkoutAccountToken(ref);
  return { linked: res.linked, accountUrl: res.manageToken ? accountUrl(res.manageToken) : null };
}

// ── Account page ─────────────────────────────────────────────

const INVALID_LINK: FormState = { status: "error", message: "This account link isn't valid any more. Ask for a new one below." };

async function accountFrom(form: FormData) {
  return findByManageToken(String(form.get("t") ?? ""));
}

/** Adds a saved search, from a pasted /jobs link or from the filter fields. */
export async function addSearchAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await accountFrom(form);
  if (!acct) return INVALID_LINK;
  let search: string | null;
  const pasted = String(form.get("link") ?? "").trim();
  if (pasted) {
    search = normalizeSearch(pasted);
    if (search === null) return { status: "error", message: "That doesn't look like a search link from our jobs page. Run a search on Jobs, then copy the address from your browser." };
  } else {
    const fields: Record<string, string> = {};
    for (const k of ["q", "where", "category", "grade", "type", "remote"]) {
      const v = String(form.get(k) ?? "").trim().slice(0, 120);
      if (v) fields[k] = v;
    }
    search = jobsUrl({ ...parseFilters(fields), page: undefined, sort: undefined, posted: undefined }).replace(/^\/jobs\??/, "");
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

export async function removeSearchAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await accountFrom(form);
  if (!acct) return INVALID_LINK;
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { status: "error", message: "Unknown search." };
  await removeSavedSearch(acct.id, id);
  refresh();
  return { status: "success", message: "Search removed." };
}

export async function frequencyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await accountFrom(form);
  if (!acct) return INVALID_LINK;
  const f = String(form.get("frequency") ?? "");
  if (f !== "daily" && f !== "weekly") return { status: "error", message: "Choose daily or weekly." };
  await sql`update subscribers set frequency = ${f} where id = ${acct.id}`;
  refresh();
  return { status: "success", message: f === "daily" ? "You'll get at most one email a day." : "You'll get at most one email a week." };
}

/** Stops all emails. A Paddle subscription keeps running until it is canceled in billing. */
export async function accountUnsubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await accountFrom(form);
  if (!acct) return INVALID_LINK;
  await sql`
    update subscribers set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null, pending_changes = null
    where id = ${acct.id} and status <> 'unsubscribed'`;
  refresh();
  return { status: "success", message: "You're unsubscribed. We won't email you again." };
}

/** Turns emails back on (the account link proves the address is theirs). */
export async function resubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await accountFrom(form);
  if (!acct) return INVALID_LINK;
  await sql`
    update subscribers set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), unsubscribed_at = null, wants_alerts = true
    where id = ${acct.id}`;
  refresh();
  return { status: "success", message: "Emails are back on." };
}

/** "Manage billing or cancel": sends the customer to a fresh Paddle customer portal session. */
export async function portalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const acct = await accountFrom(form);
  if (!acct) return INVALID_LINK;
  if (!acct.paddle_customer_id) return { status: "error", message: "There's no billing account for this address yet." };
  if (!isPaddleApiConfigured()) return { status: "error", message: "Billing management isn't available right now. Please email us and we'll help." };
  const h = await headers();
  if (!(await rateLimit(`portal:${clientIp(h)}`, 20, 3600))) return { status: "error", message: "Too many attempts. Please try again later." };
  let url: string;
  try {
    url = await createPortalSession(acct.paddle_customer_id, acct.paddle_subscription_id);
  } catch (e) {
    console.error("portal session failed", (e as Error).message);
    return { status: "error", message: "We couldn't open billing just now. Please try again in a minute." };
  }
  redirect(url); // outside try: redirect() works by throwing
}

const LOGIN_MESSAGE = "If this address has an account with us, we've emailed it the link. It can take a minute or two to arrive; check your spam folder too.";

/** "Email me my account link". Always the same answer, so it can't tell anyone who is subscribed. */
export async function accountLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (String(form.get("website") ?? "")) return { status: "success", message: LOGIN_MESSAGE };
  const h = await headers();
  if (!(await rateLimit(`account-login:${clientIp(h)}`, 5, 3600))) {
    return { status: "error", message: "Too many requests from this connection. Please try again in an hour." };
  }
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!email) return { status: "error", message: "Enter a valid email address." };
  try {
    // Per address too, so nobody can flood someone's inbox from many connections.
    if (await rateLimit(`account-link:${email}`, 3, 3600)) await sendAccountLink(email);
  } catch (e) {
    console.error("account link failed", (e as Error).message);
  }
  return { status: "success", message: LOGIN_MESSAGE };
}
