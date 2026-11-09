"use client";

/** Forms on the account page (/account) and "Email me my account link" (/account/login). */
import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import {
  accountLinkAction, accountUnsubscribeAction, addSearchAction, frequencyAction, portalAction, removeSearchAction, resubscribeAction,
} from "@/app/billing-actions";

const initial: FormState = { status: "idle", message: "" };

const field =
  "w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-[0.95rem] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]";
const primary = "rounded-lg bg-brand px-5 py-2.5 text-[0.95rem] font-semibold text-white hover:bg-accent disabled:opacity-60";
const secondary = "rounded-lg border border-rule bg-paper px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-60";

function Message({ state }: { state: FormState }) {
  if (state.status === "idle") return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={`mt-2 text-sm ${state.status === "error" ? "text-[#9b1c1c]" : "text-remote"}`}>
      {state.message}
    </p>
  );
}

export function RemoveSearchButton({ t, id }: { t: string; id: number }) {
  const [state, action, pending] = useActionState(removeSearchAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="t" value={t} />
      <input type="hidden" name="id" value={String(id)} />
      <button disabled={pending} className={secondary}>{pending ? "Removing…" : "Remove"}</button>
      {state.status === "error" ? <Message state={state} /> : null}
    </form>
  );
}

type Opt = { value: string; label: string };

/** Add a search by pasting a /jobs link, or by picking a few filters. */
export function AddSearchForm({ t, where, categories, grades, types }: { t: string; where: { label: string; options: Opt[] }[]; categories: Opt[]; grades: Opt[]; types: Opt[] }) {
  const [state, action, pending] = useActionState(addSearchAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="t" value={t} />
      <div>
        <label htmlFor="add-link" className="mb-1.5 block text-sm font-medium text-ink">Paste a search link</label>
        <input id="add-link" name="link" placeholder="e.g. a link copied from the Jobs page after filtering" className={field} />
        <p className="mt-1 text-sm text-slate">Search and filter on the Jobs page, then copy the address from your browser. Or leave this empty and pick filters below.</p>
      </div>
      <details className="rounded-lg border border-rule p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Build a search from filters</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="add-q" className="mb-1.5 block text-sm font-medium text-ink">Keywords</label>
            <input id="add-q" name="q" maxLength={120} placeholder="e.g. data analyst, WASH, UNICEF" className={field} />
          </div>
          <div>
            <label htmlFor="add-where" className="mb-1.5 block text-sm font-medium text-ink">Where</label>
            <select id="add-where" name="where" defaultValue="" className={field}>
              <option value="">Anywhere</option>
              {where.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="add-category" className="mb-1.5 block text-sm font-medium text-ink">Category</label>
            <select id="add-category" name="category" defaultValue="" className={field}>
              <option value="">Any category</option>
              {categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="add-grade" className="mb-1.5 block text-sm font-medium text-ink">Grade</label>
            <select id="add-grade" name="grade" defaultValue="" className={field}>
              <option value="">Any grade</option>
              {grades.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="add-type" className="mb-1.5 block text-sm font-medium text-ink">Contract type</label>
            <select id="add-type" name="type" defaultValue="" className={field}>
              <option value="">Any contract</option>
              {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2.5 text-[0.95rem] text-ink sm:col-span-2">
            <input type="checkbox" name="remote" value="1" className="h-4 w-4 accent-[var(--accent)]" />
            Remote only
          </label>
        </div>
      </details>
      <button disabled={pending} className={primary}>{pending ? "Saving…" : "Add this search"}</button>
      <Message state={state} />
    </form>
  );
}

export function FrequencyForm({ t, current }: { t: string; current: "daily" | "weekly" }) {
  const [state, action, pending] = useActionState(frequencyAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="t" value={t} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="How often">
        {(["daily", "weekly"] as const).map((f) => (
          <button
            key={f}
            name="frequency"
            value={f}
            disabled={pending}
            aria-pressed={current === f}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${current === f ? "border-brand bg-brand text-white" : "border-rule bg-paper text-ink hover:border-accent hover:text-accent"}`}
          >
            {f === "daily" ? "Daily" : "Weekly"}
          </button>
        ))}
      </div>
      <Message state={state} />
    </form>
  );
}

export function PortalButton({ t }: { t: string }) {
  const [state, action, pending] = useActionState(portalAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="t" value={t} />
      <button disabled={pending} className={primary}>{pending ? "Opening billing…" : "Manage billing or cancel"}</button>
      <Message state={state} />
    </form>
  );
}

export function AccountUnsubscribe({ t, unsubscribed, paying }: { t: string; unsubscribed: boolean; paying: boolean }) {
  const [state, action, pending] = useActionState(unsubscribed ? resubscribeAction : accountUnsubscribeAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="t" value={t} />
      {unsubscribed ? (
        <p className="mb-3 text-[0.95rem] text-slate">You&apos;re unsubscribed: we don&apos;t send you any emails.{paying ? " Your plan is still running; cancel it under billing if you no longer want it." : ""}</p>
      ) : (
        <p className="mb-3 text-[0.95rem] text-slate">Stops every email from us.{paying ? " It doesn't cancel your plan: use \"Manage billing or cancel\" for that." : ""}</p>
      )}
      <button disabled={pending} className={secondary}>{pending ? "Saving…" : unsubscribed ? "Turn emails back on" : "Unsubscribe from all emails"}</button>
      <Message state={state} />
    </form>
  );
}

export function AccountLinkForm() {
  const [state, action, pending] = useActionState(accountLinkAction, initial);
  if (state.status === "success") return <p role="status" className="rounded-xl bg-remote-bg p-5 text-[1.02rem] leading-relaxed text-ink">{state.message}</p>;
  return (
    <form action={action} className="space-y-3">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label htmlFor="login-email" className="block text-sm font-medium text-ink">Email address</label>
      <input id="login-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} />
      <button disabled={pending} className={primary}>{pending ? "Sending…" : "Email me my account link"}</button>
      <Message state={state} />
    </form>
  );
}
