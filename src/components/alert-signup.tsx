"use client";

import { useActionState, useEffect } from "react";
import dynamic from "next/dynamic";
import { signupAction, type FormState } from "@/app/actions";
import siteConfig from "@site-config";
import { adConversion, AttributionField } from "./ads";
import { EarlyAccessDone } from "./early-access";
import { EARLY_ACCESS_BUTTON, earlyAccessLine } from "@/lib/early-access-copy";
import { BILLING_LIVE } from "@/lib/billing/live";
import { PrivacyNote } from "./token-forms";

// Paddle's checkout code loads only where the checkout form is shown (billing live), not with every page that has this form.
const TrialCheckoutForm = dynamic(() => import("./paddle-checkout").then((m) => m.TrialCheckoutForm));

const initial: FormState = { status: "idle", message: "" };

/**
 * Email alert sign-up (double opt-in). When alerts are paid
 * (siteConfig.freeWeeklyEmail = false) it is the early-access sign-up of the
 * concept test: it says plainly that alerts aren't open and nothing is charged.
 * Once billing is live (BILLING_LIVE) paid alerts start a real free trial instead.
 */
export function AlertSignup({ source, tone = "light" }: { source: string; tone?: "light" | "dark" }) {
  if (BILLING_LIVE && !siteConfig.freeWeeklyEmail) return <TrialCheckoutForm source={source} tone={tone} compact />;
  return <EarlyAccessSignup source={source} tone={tone} />;
}

function EarlyAccessSignup({ source, tone = "light" }: { source: string; tone?: "light" | "dark" }) {
  const [state, action, pending] = useActionState(signupAction, initial);
  const dark = tone === "dark";
  const paid = !siteConfig.freeWeeklyEmail;
  useEffect(() => {
    if (state.status === "success") {
      // "subscribe" (the free weekly email) is also Meta's "Lead".
      adConversion(paid ? "trial_signup" : "subscribe", { event_category: paid ? "premium" : "alerts", event_label: source });
    }
  }, [state.status, source, paid]);

  if (state.status === "success") {
    if (paid) return <EarlyAccessDone message={state.message} source={source} tone={tone} />;
    return (
      <p role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink"}`}>
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="@container w-full">
      <input type="hidden" name="kind" value={paid ? "waitlist" : "alerts"} />
      <input type="hidden" name="source" value={source} />
      <AttributionField />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label htmlFor={`email-${source}`} className={`mb-1.5 block text-sm font-medium ${dark ? "text-white/90" : "text-ink"}`}>
        Email address
      </label>
      <div className="flex flex-col gap-3 @md:flex-row">
        <input
          id={`email-${source}`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={`w-full min-w-0 flex-1 rounded-lg border px-4 py-3 text-base focus:outline-none focus:ring-2 ${
            dark ? "border-white/25 bg-white text-ink focus:ring-white/40" : "border-rule bg-paper text-ink focus:border-accent focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
          }`}
        />
        <button
          type="submit"
          disabled={pending}
          className={`rounded-lg px-5 py-3 text-base font-semibold disabled:opacity-60 ${dark ? "bg-highlight text-ink hover:brightness-95" : "bg-brand text-white hover:bg-accent"}`}
        >
          {pending ? "Saving…" : paid ? EARLY_ACCESS_BUTTON : "Subscribe"}
        </button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className={`mt-2 text-sm ${dark ? "text-[#ffd7d7]" : "text-[#9b1c1c]"}`}>{state.message}</p>
      ) : (
        <p className={`mt-2 text-sm ${dark ? "text-white/90" : "text-slate"}`}>
          {paid
            ? earlyAccessLine()
            : "We'll email you once to confirm. Unsubscribe any time."}
        </p>
      )}
      <PrivacyNote className={`mt-1 text-sm ${dark ? "text-white/90" : "text-slate"}`} />
    </form>
  );
}
