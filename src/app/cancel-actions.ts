"use server";

/**
 * "Cancel plan" on the account page: straight to Paddle's cancel page for the subscription (the
 * cancel deep link of a fresh customer portal session), instead of the portal overview that
 * "Manage billing" opens. The same checks as "Manage billing" (openPortal in ./billing-actions.ts):
 * the private account link, a rate limit per connection, and the Paddle customer verified against
 * this subscriber's address before anything is opened.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findByManageToken } from "@/lib/account";
import { createCancelSession, isPaddleApiConfigured, userPaddleBudget } from "@/lib/billing/paddle";
import { verifiedCustomerFor } from "@/lib/billing/subscriptions";
import { clientIp, safeRateLimit } from "@/lib/rate-limit";
import { siteConfig } from "@/lib/site";
import type { FormState } from "@/app/actions";

const TRY_AGAIN: FormState = { status: "error", message: "We couldn't open billing just now. Please try again in a minute." };

export async function cancelPlanAction(_prev: FormState, form: FormData): Promise<FormState> {
  let acct: Awaited<ReturnType<typeof findByManageToken>>;
  try {
    acct = await findByManageToken(String(form.get("t") ?? ""));
  } catch (e) {
    console.error("cancel plan: account lookup failed", (e as Error).message);
    return { status: "error", message: "Something went wrong on our side. Please try again in a minute." };
  }
  if (!acct) return { status: "error", message: "This account link isn't valid any more. Ask for a new one below." };
  const subscriptionId = acct.paddle_subscription_id;
  if (!subscriptionId) return { status: "error", message: "There's no plan to cancel for this address." };
  if (!isPaddleApiConfigured()) return { status: "error", message: "Billing management isn't available right now. Please email us and we'll help." };
  const limit = await safeRateLimit(`portal:${clientIp(await headers())}`, 20, 3600);
  if (limit === "error") return TRY_AGAIN;
  if (limit === "limited") return { status: "error", message: "Too many attempts. Please try again later." };
  let url: string;
  try {
    // One time budget for both Paddle calls: the visitor is waiting.
    const budget = userPaddleBudget();
    const customerId = await verifiedCustomerFor(acct, budget);
    if (!customerId) {
      const mail = siteConfig.contactEmail;
      return { status: "error", message: `We couldn't open billing for this address. Please email us${mail ? ` at ${mail}` : ""} and we'll help.` };
    }
    url = await createCancelSession(customerId, subscriptionId, budget);
  } catch (e) {
    console.error("cancel session failed", (e as Error).message);
    return TRY_AGAIN;
  }
  redirect(url); // outside try: redirect() works by throwing
}
