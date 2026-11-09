/**
 * Agreement to automatic renewal (server only). The checkout forms' required checkbox is checked
 * again on the server (startCheckoutAction, continueCheckoutAction), and the checkout record keeps
 * when it was ticked and which wording it was: a short hash of the checkbox text and the terms
 * shown with it, so a later change of wording gives a new version (db/migrations/019).
 */
import { createHash } from "node:crypto";
import { NO_TRIAL_RENEWAL_ACK, noTrialLine, TRIAL_RENEWAL_ACK, TRIAL_TERMS } from "@/lib/early-access-copy";
import type { CheckoutPlan } from "@/lib/billing/subscriptions";

/** Shown when the checkbox wasn't ticked (the browser normally won't submit the form without it). */
export const RENEWAL_ACK_REQUIRED = "Please tick the box to agree to automatic renewal.";

/** Whether the form carried the ticked "renews automatically" checkbox. */
export function renewalAcknowledged(form: FormData): boolean {
  return form.get("renewal_ack") === "on";
}

/** The version of the wording agreed to: with a trial, the checkbox and the trial terms; without, the checkbox and the plan's line. */
export function renewalTermsVersion(trial: boolean, plan: CheckoutPlan): string {
  const text = trial ? `${TRIAL_RENEWAL_ACK}\n${TRIAL_TERMS}` : `${NO_TRIAL_RENEWAL_ACK}\n${noTrialLine(plan)}`;
  return `${trial ? "trial" : "plan"}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}
