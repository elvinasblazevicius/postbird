"use client";

import { useActionState } from "react";
import { feedbackAction, type FeedbackState } from "./actions";

const field = "w-full rounded-lg border border-rule bg-paper px-4 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]";
const initial: FeedbackState = { status: "idle", message: "" };

export function FeedbackForm({ page, kind = "feature" }: { page: string | null; kind?: string }) {
  const [state, action, pending] = useActionState(feedbackAction, initial);
  if (state.status === "success") {
    return (
      <p role="status" className="rounded-xl border border-sky-rule bg-sky-wash px-4 py-3 text-ink">
        Thank you. We read every message, and the most requested ideas are the ones we build next.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-5">
      {page ? <input type="hidden" name="page" value={page} /> : null}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">What is it about?</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {[["feature", "A feature I'd like"], ["problem", "Something isn't working"], ["other", "Something else"]].map(([v, l]) => (
            <label key={v} className="inline-flex min-h-11 items-center gap-2 text-ink">
              <input type="radio" name="kind" value={v} defaultChecked={v === (state.values?.kind || kind)} className="h-4 w-4 accent-[var(--brand)]" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="fb-message" className="mb-1.5 block text-sm font-medium text-ink">Your idea or message</label>
        <textarea id="fb-message" name="message" defaultValue={state.values?.message} required minLength={5} maxLength={2000} rows={6} className={field}
          placeholder="e.g. Let me filter by contract length, or send alerts in French" />
      </div>
      <div>
        <label htmlFor="fb-email" className="mb-1.5 block text-sm font-medium text-ink">
          Email address <span className="font-normal text-slate">(optional, if you&apos;d like a reply)</span>
        </label>
        <input id="fb-email" name="email" type="email" defaultValue={state.values?.email} autoComplete="email" placeholder="you@example.com" className={field} />
      </div>
      {state.status === "error" ? <p role="alert" className="text-sm text-[#9b1c1c]">{state.message}</p> : null}
      <button disabled={pending} className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent disabled:opacity-60">
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
