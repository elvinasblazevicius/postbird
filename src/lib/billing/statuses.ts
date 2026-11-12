/**
 * Billing statuses and billing flag kinds, defined once (no imports, so any
 * module can use them without an import cycle). Pass the arrays to SQL as
 * parameters (`billing_status = any(${LIVE_STATUSES})`) rather than repeating
 * the values in the query.
 */
export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "paused" | "canceled";

/** Statuses that receive paid alerts. */
export const ALERT_STATUSES: BillingStatus[] = ["trialing", "active"];
/**
 * Statuses where a Paddle subscription still exists (not yet canceled): a plan. Same rule as the
 * database trigger on saved searches (migration 026). Subscribers with one never get the free weekly email.
 */
export const LIVE_STATUSES: BillingStatus[] = ["trialing", "active", "past_due", "paused"];

/** Whether a billing status (any string from the database) is one of LIVE_STATUSES. */
export const isLiveStatus = (status: string | null | undefined): boolean => (LIVE_STATUSES as string[]).includes(status ?? "");

/** Every kind of billing flag (Admin → Overview; the check constraint in migration 015). */
export const BILLING_FLAG_KINDS = ["trial_blocked", "customer_mismatch", "customer_unverified", "duplicate_subscription", "trial_unconfirmed"] as const;
export type BillingFlagKind = (typeof BILLING_FLAG_KINDS)[number];

export const isBillingFlagKind = (kind: string): kind is BillingFlagKind => (BILLING_FLAG_KINDS as readonly string[]).includes(kind);
