"use client";

import { useActionState } from "react";
import { feedbackAction, type FeedbackState } from "../feedback/actions";

const field = "w-full rounded-lg border border-rule bg-paper px-4 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]";
const initial: FeedbackState = { status: "idle", message: "" };

/** /share: a subscriber's experience, quoted on the site only with their permission and after review. */
export function StoryForm({ page }: { page: string | null }) {
  const [state, action, pending] = useActionState(feedbackAction, initial);
  if (state.status === "success") {
    return (
      <p role="status" className="rounded-xl border border-sky-rule bg-sky-wash px-4 py-3 text-ink">
        Thank you for taking the time. If you agreed to be quoted, we may show your words on the site; we never change them, and you can ask us to take them down at any time.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="kind" value="testimonial" />
      {page ? <input type="hidden" name="page" value={page} /> : null}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div>
        <label htmlFor="st-message" className="mb-1.5 block text-sm font-medium text-ink">Your experience</label>
        <textarea id="st-message" name="message" defaultValue={state.values?.message} required minLength={5} maxLength={1200} rows={6} className={field}
          placeholder="e.g. The reminder came three days before the deadline, and I sent my application in time." />
      </div>
      <div>
        <label htmlFor="st-name" className="mb-1.5 block text-sm font-medium text-ink">
          Name to show with your words <span className="font-normal text-slate">(optional)</span>
        </label>
        <input id="st-name" name="display_name" defaultValue={state.values?.display_name} maxLength={80} autoComplete="off" placeholder="e.g. Amina, WASH officer, Nairobi" className={field} />
        <p className="mt-1.5 text-sm text-slate">A first name and your field or city is enough.</p>
      </div>
      <label className="flex items-start gap-2.5 text-ink">
        <input type="checkbox" name="quote_ok" value="1" defaultChecked={state.values?.quote_ok === "1"} className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]" />
        <span>You may quote these words on the site with the name above. <span className="text-slate">We don&apos;t edit them, and you can withdraw this at any time.</span></span>
      </label>
      <div>
        <label htmlFor="st-email" className="mb-1.5 block text-sm font-medium text-ink">
          Email address <span className="font-normal text-slate">(optional, never shown)</span>
        </label>
        <input id="st-email" name="email" type="email" defaultValue={state.values?.email} autoComplete="email" placeholder="you@example.com" className={field} />
      </div>
      {state.status === "error" ? <p role="alert" className="text-sm text-[#9b1c1c]">{state.message}</p> : null}
      <button disabled={pending} className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent disabled:opacity-60">
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
