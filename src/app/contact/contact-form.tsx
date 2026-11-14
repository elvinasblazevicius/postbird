"use client";

import { useActionState } from "react";
import { feedbackAction, type FeedbackState } from "../feedback/actions";

const field = "w-full rounded-lg border border-rule bg-paper px-4 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]";
const initial: FeedbackState = { status: "idle", message: "" };
const TOPICS: [string, string][] = [
  ["question", "A question about the site"],
  ["billing", "Billing or my subscription"],
  ["problem", "Something isn't working"],
  ["partnership", "Partnership or press"],
  ["other", "Something else"],
];

/** /contact: a message to the team, with the address to reply to (src/app/feedback/actions.ts). */
export function ContactForm({ topic = "question", page }: { topic?: string; page: string | null }) {
  const [state, action, pending] = useActionState(feedbackAction, initial);
  if (state.status === "success") {
    return (
      <p role="status" className="rounded-xl border border-sky-rule bg-sky-wash px-4 py-3 text-ink">
        Thank you, your message is on its way. We reply by email, usually within two working days.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="kind" value="contact" />
      {page ? <input type="hidden" name="page" value={page} /> : null}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div>
        <label htmlFor="ct-topic" className="mb-1.5 block text-sm font-medium text-ink">What is it about?</label>
        <select id="ct-topic" name="topic" defaultValue={state.values?.topic || (TOPICS.some(([v]) => v === topic) ? topic : "question")} className={field}>
          {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ct-message" className="mb-1.5 block text-sm font-medium text-ink">Your message</label>
        <textarea id="ct-message" name="message" defaultValue={state.values?.message} required minLength={5} maxLength={2000} rows={6} className={field} />
      </div>
      <div>
        <label htmlFor="ct-email" className="mb-1.5 block text-sm font-medium text-ink">Your email address</label>
        <input id="ct-email" name="email" type="email" defaultValue={state.values?.email} required autoComplete="email" placeholder="you@example.com" className={field} />
        <p className="mt-1.5 text-sm text-slate">For your subscription, use the address your alerts go to.</p>
      </div>
      {state.status === "error" ? <p role="alert" className="text-sm text-[#9b1c1c]">{state.message}</p> : null}
      <button disabled={pending} className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent disabled:opacity-60">
        {pending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
