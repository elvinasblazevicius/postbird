"use client";

import { useActionState, useEffect } from "react";
import { signupAction, type FormState } from "@/app/actions";
import { AttributionField, uetEvent } from "./ads";

const initial: FormState = { status: "idle", message: "" };

/** Email sign-up for the weekly digest (double opt-in). */
export function AlertSignup({ source, tone = "light" }: { source: string; tone?: "light" | "dark" }) {
  const [state, action, pending] = useActionState(signupAction, initial);
  const dark = tone === "dark";
  useEffect(() => {
    if (state.status === "success") uetEvent("subscribe", { event_category: "alerts", event_label: source });
  }, [state.status, source]);

  if (state.status === "success") {
    return (
      <p role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink"}`}>
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="w-full">
      <input type="hidden" name="kind" value="alerts" />
      <input type="hidden" name="source" value={source} />
      <AttributionField />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label htmlFor={`email-${source}`} className={`mb-1.5 block text-sm font-medium ${dark ? "text-white/90" : "text-ink"}`}>
        Email address
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={`email-${source}`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={`w-full flex-1 rounded-lg border px-4 py-3 text-base focus:outline-none focus:ring-2 ${
            dark ? "border-white/25 bg-white text-ink focus:ring-white/40" : "border-rule bg-paper text-ink focus:border-accent focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
          }`}
        />
        <button
          type="submit"
          disabled={pending}
          className={`rounded-lg px-5 py-3 text-base font-semibold disabled:opacity-60 ${dark ? "bg-white text-brand hover:bg-mist" : "bg-brand text-white hover:bg-accent"}`}
        >
          {pending ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className={`mt-2 text-sm ${dark ? "text-[#ffd7d7]" : "text-[#9b1c1c]"}`}>{state.message}</p>
      ) : (
        <p className={`mt-2 text-sm ${dark ? "text-white/70" : "text-slate"}`}>We&apos;ll email you once to confirm. Unsubscribe any time.</p>
      )}
    </form>
  );
}
