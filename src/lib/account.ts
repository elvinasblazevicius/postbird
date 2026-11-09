/** The subscriber's account page (/account?t=<manage_token>): lookups and the "email me my link" message. */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { accountLinkEmail } from "@/lib/email-templates";
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
  paddle_customer_id: string | null;
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
    select id::int as id, email, status, weekly_email, frequency, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at, canceled_at,
           paddle_customer_id, paddle_subscription_id, unsubscribe_token, manage_token
    from subscribers where manage_token = ${t}`;
  return row ?? null;
}

export const accountUrl = (manageToken: string) => absoluteUrl(`/account?t=${manageToken}`);

/** A new account token: 64 hex characters, like the database default (see isManageToken). */
const newManageToken = () => randomBytes(32).toString("hex");

/**
 * Emails the account link to the address (only ever to the address itself).
 * The link is replaced by a new one first, so links from older emails (or a
 * forwarded one) stop working. Emails sent later (alerts, reminders) read the
 * current link when they are sent. Returns false if sending failed.
 */
export async function sendAccountLink(email: string): Promise<boolean> {
  const [row] = await sql<{ id: number; manage_token: string; unsubscribe_token: string }[]>`
    update subscribers set manage_token = ${newManageToken()} where email = ${email}
    returning id::int as id, manage_token, unsubscribe_token`;
  if (!row) {
    console.info("account link: no subscriber with that address"); // the address itself is never logged
    return true; // nothing to send; callers reply the same either way
  }
  const oneClick = absoluteUrl(`/api/unsubscribe?token=${row.unsubscribe_token}`);
  const res = await sendEmail({
    to: email,
    ...accountLinkEmail({ accountUrl: accountUrl(row.manage_token), unsubscribeUrl: absoluteUrl(`/alerts/unsubscribe?token=${row.unsubscribe_token}`) }),
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    // One key per new link (a hash, so the token itself never leaves in the key).
    idempotencyKey: `account-link:${row.id}:${createHash("sha256").update(row.manage_token).digest("hex").slice(0, 16)}`,
  });
  return res.ok || Boolean(res.skipped);
}
