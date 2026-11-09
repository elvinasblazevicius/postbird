"use client";

import { useActionState, useEffect } from "react";
import { confirmAction, signupAction, unsubscribeAction, type FormState } from "@/app/actions";
import { unsubscribePortalAction } from "@/app/billing-actions";
import siteConfig from "@site-config";
import { AttributionField, uetEvent } from "./ads";
import { EarlyAccessDone } from "./early-access";
import { EARLY_ACCESS_BUTTON, earlyAccessLine } from "@/lib/early-access-copy";
import { BILLING_LIVE } from "@/lib/billing/live";
import { TrialCheckoutForm } from "./paddle-checkout";

const initial: FormState = { status: "idle", message: "" };

function Result({ state }: { state: FormState }) {
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${state.status === "error" ? "bg-signal-bg text-ink" : "bg-remote-bg text-ink"}`}>
      {state.message}
    </p>
  );
}

/** Confirmation needs a click (not just opening the link) so email scanners can't confirm on someone's behalf. */
export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmAction, initial);
  if (state.status !== "idle") return <Result state={state} />;
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button disabled={pending} className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent disabled:opacity-60">
        {pending ? "Confirming…" : "Confirm my email"}
      </button>
    </form>
  );
}

export function UnsubscribeForm({ token, label = "Unsubscribe", secondary = false }: { token: string; label?: string; secondary?: boolean }) {
  const [state, action, pending] = useActionState(unsubscribeAction, initial);
  if (state.status !== "idle") return <Result state={state} />;
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button
        disabled={pending}
        className={secondary
          ? "rounded-lg border border-rule bg-paper px-6 py-3 text-base font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-60"
          : "rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent disabled:opacity-60"}
      >
        {pending ? "Unsubscribing…" : label}
      </button>
    </form>
  );
}

/** "Cancel my plan" on the unsubscribe page: opens a fresh Paddle customer portal session. */
export function CancelPlanForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(unsubscribePortalAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button disabled={pending} className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent disabled:opacity-60">
        {pending ? "Opening billing…" : "Cancel my plan"}
      </button>
      {state.status === "error" ? <p role="alert" className="mt-2 text-sm text-[#9b1c1c]">{state.message}</p> : null}
    </form>
  );
}

const field = "w-full rounded-lg border border-rule bg-paper px-4 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]";

/**
 * Paid-alerts form on /pricing/trial. While billing is off: the early-access
 * form of the concept test (records interest, takes no payment). Once billing
 * is live: plan, email and the Paddle checkout for the free trial.
 */
export function PremiumInterestForm({ source = "pricing", search, remindJobId }: { source?: string; search?: string; remindJobId?: number }) {
  if (BILLING_LIVE) return <TrialCheckoutForm source={source} search={search} />;
  return <EarlyAccessForm source={source} search={search} remindJobId={remindJobId} />;
}

function EarlyAccessForm({ source = "pricing", search, remindJobId }: { source?: string; search?: string; remindJobId?: number }) {
  const [state, action, pending] = useActionState(signupAction, initial);
  useEffect(() => {
    if (state.status === "success") uetEvent("trial_signup", { event_category: "premium" });
  }, [state.status]);
  if (state.status === "success") return <EarlyAccessDone message={state.message} source={source} />;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="kind" value="waitlist" />
      <input type="hidden" name="source" value={source} />
      {search ? <input type="hidden" name="search" value={search} /> : null}
      {remindJobId ? <input type="hidden" name="remind_job" value={String(remindJobId)} /> : null}
      <AttributionField />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div>
        <label htmlFor="pi-email" className="mb-1.5 block text-sm font-medium text-ink">Email address</label>
        <input id="pi-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} />
      </div>
      {search ? null : (
        <>
      <div>
        <label htmlFor="pi-keywords" className="mb-1.5 block text-sm font-medium text-ink">Roles or keywords to watch <span className="font-normal text-slate">(optional)</span></label>
        <input id="pi-keywords" name="keywords" placeholder="e.g. data analyst, M&E, WASH" className={field} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pi-orgs" className="mb-1.5 block text-sm font-medium text-ink">Organizations <span className="font-normal text-slate">(optional)</span></label>
          <input id="pi-orgs" name="organizations" placeholder="e.g. UNICEF, WHO" className={field} />
        </div>
        <div>
          <label htmlFor="pi-locations" className="mb-1.5 block text-sm font-medium text-ink">Locations <span className="font-normal text-slate">(optional)</span></label>
          <input id="pi-locations" name="locations" placeholder="e.g. Geneva, remote" className={field} />
        </div>
      </div>
        </>
      )}
      <div>
        <label htmlFor="pi-note" className="mb-1.5 block text-sm font-medium text-ink">Anything else you&apos;d want from {siteConfig.premium.name.toLowerCase()}? <span className="font-normal text-slate">(optional)</span></label>
        <textarea id="pi-note" name="note" rows={3} className={field} />
      </div>
      {state.status === "error" ? <p role="alert" className="text-sm text-[#9b1c1c]">{state.message}</p> : null}
      <button disabled={pending} className="w-full rounded-lg bg-brand px-6 py-3.5 text-base font-semibold text-white hover:bg-accent disabled:opacity-60">
        {pending ? "Saving…" : EARLY_ACCESS_BUTTON}
      </button>
      <p className="text-sm text-slate">
        {earlyAccessLine()}
      </p>
    </form>
  );
}
