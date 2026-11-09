/** The subscriber's account page (/account?t=<manage_token>): lookups and the "email me my link" message. */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { accountLinkEmail } from "@/lib/email-templates";
import { takeDailyQuota } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/site";
import type { BillingStatus, PlanInterval } from "@/lib/billing/subscriptions";

export type Account = {
  id: number;
  email: string;
  status: "pending" | "confirmed" | "unsubscribed";
  /** Signed up (and confirmed) for the free weekly email; only sent while there is no plan. */
  weekly_email: boolean;
  frequency: "daily" | "weekly";
  billing_status: BillingStatus;
  plan_interval: PlanInterval | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  cancel_at: Date | null;
  canceled_at: Date | null;
  confirmed_at: Date | null;
  paddle_customer_id: string | null;
  /** Set once the Paddle customer was checked against this address (see verifiedCustomerFor). */
  paddle_customer_verified_at: Date | null;
  paddle_subscription_id: string | null;
  unsubscribe_token: string;
  manage_token: string;
};

/** Tokens are 64 hex characters (see db/migrations/004_billing.sql). */
export function isManageToken(t: unknown): t is string {
  return typeof t === "string" && /^[0-9a-f]{64}$/.test(t);
}

export async function findByManageToken(t: unknown): Promise<Account | null> {
  if (!isManageToken(t)) return null;
  const [row] = await sql<Account[]>`
    select id::int as id, email, status, weekly_email, frequency, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at, canceled_at, confirmed_at,
           paddle_customer_id, paddle_customer_verified_at, paddle_subscription_id, unsubscribe_token, manage_token
    from subscribers where manage_token = ${t}`;
  return row ?? null;
}

export const accountUrl = (manageToken: string) => absoluteUrl(`/account?t=${manageToken}`);

/** A new account token: 64 hex characters, like the database default (see isManageToken). */
const newManageToken = () => randomBytes(32).toString("hex");

/**
 * At most this many account-link emails per address in any 24 hours, on top
 * of the callers' hourly limits (3 per hour per address), so nobody can flood
 * someone's inbox, or keep replacing their link, all day.
 */
export const ACCOUNT_LINKS_PER_DAY = 5;

/**
 * What the email is for, which only changes its wording: "manage" (the
 * account link), "cancel" (the same link, worded for cancelling a plan) or
 * "already" (someone started a checkout with an address that already has
 * daily alerts).
 */
export type AccountLinkPurpose = "manage" | "cancel" | "already";

/**
 * Emails the account link to the address (only ever to the address itself).
 * The email carries a NEW link, which replaces the old one once the email has
 * been sent: links from older emails (or a forwarded one) then stop working.
 * If sending fails, nothing is replaced, so the links already in the
 * subscriber's inbox keep working. Emails sent later (alerts, reminders) read
 * the current link when they are sent. Returns false if sending failed. Over
 * the daily cap nothing is sent or replaced, and it returns true like a send,
 * so callers reply the same either way (nothing about the address is revealed).
 */
export async function sendAccountLink(email: string, purpose: AccountLinkPurpose = "manage"): Promise<boolean> {
  // Counted before the lookup, so addresses with and without an account are treated alike.
  if (isEmailConfigured() && !(await takeDailyQuota(`account-link-day|${email}`, ACCOUNT_LINKS_PER_DAY))) {
    console.info("account link: daily limit reached for this address"); // the address itself is never logged
    return true;
  }
  const [row] = await sql<{ id: number; manage_token: string; unsubscribe_token: string }[]>`
    select id::int as id, manage_token, unsubscribe_token from subscribers where email = ${email}`;
  if (!row) {
    console.info("account link: no subscriber with that address"); // the address itself is never logged
    return true; // nothing to send; callers reply the same either way
  }
  const next = newManageToken();
  const oneClick = absoluteUrl(`/api/unsubscribe?token=${row.unsubscribe_token}`);
  const res = await sendEmail({
    to: email,
    ...accountLinkEmail({ accountUrl: accountUrl(next), unsubscribeUrl: absoluteUrl(`/alerts/unsubscribe?token=${row.unsubscribe_token}`), purpose }),
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    // One key per new link (a hash, so the token itself never leaves in the key).
    idempotencyKey: `account-link:${row.id}:${createHash("sha256").update(next).digest("hex").slice(0, 16)}`,
  });
  // Only a link that reached the inbox replaces the old one.
  if (res.ok) await sql`update subscribers set manage_token = ${next} where id = ${row.id}`;
  return res.ok || Boolean(res.skipped);
}
