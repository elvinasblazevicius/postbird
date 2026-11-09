/** The subscriber's account page (/account?t=<manage_token>): lookups and the "email me my link" message. */
import { sql } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { accountLinkEmail } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/site";
import type { BillingStatus, PlanInterval } from "@/lib/billing/subscriptions";

export type Account = {
  id: number;
  email: string;
  status: "pending" | "confirmed" | "unsubscribed";
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
    select id::int as id, email, status, frequency, billing_status, plan_interval, trial_ends_at, current_period_end, cancel_at, canceled_at,
           paddle_customer_id, paddle_subscription_id, unsubscribe_token, manage_token
    from subscribers where manage_token = ${t}`;
  return row ?? null;
}

export const accountUrl = (manageToken: string) => absoluteUrl(`/account?t=${manageToken}`);

/** Emails the account link to the address (only ever to the address itself). Returns false if sending failed. */
export async function sendAccountLink(email: string): Promise<boolean> {
  const [row] = await sql<{ manage_token: string; unsubscribe_token: string }[]>`
    select manage_token, unsubscribe_token from subscribers where email = ${email}`;
  if (!row) return true; // nothing to send; callers reply the same either way
  const oneClick = absoluteUrl(`/api/unsubscribe?token=${row.unsubscribe_token}`);
  const res = await sendEmail({
    to: email,
    ...accountLinkEmail({ accountUrl: accountUrl(row.manage_token), unsubscribeUrl: absoluteUrl(`/alerts/unsubscribe?token=${row.unsubscribe_token}`) }),
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  return res.ok || Boolean(res.skipped);
}
