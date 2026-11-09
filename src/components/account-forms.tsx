"use client";

/** Forms on the account page (/account) and "Email me my account link" (/account/login). */
import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import { cancelPlanAction } from "@/app/cancel-actions";
import {
  accountLinkAction, accountUnsubscribeAction, addSearchAction, frequencyAction, portalAction, removeSearchAction, restartPlanAction, resubscribeAction,
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

/** The "Build a search from filters" fields, in the order a /jobs link writes them. */
const BUILDER_FIELDS = ["q", "org", "where", "grade", "lang", "exp", "category", "remote", "type", "hidelocal"] as const;

/**
 * The builder's filters as a /jobs link, the same saved search the Jobs page's address gives
 * ("" fields left out), for the "link" field the server reads. The server also reads some of these
 * fields on their own; the link carries all of them.
 */
export function builderLink(form: FormData): string {
  const p = new URLSearchParams();
  for (const k of BUILDER_FIELDS) {
    const v = String(form.get(k) ?? "").trim().slice(0, 120);
    if (v) p.append(k, v);
  }
  const q = p.toString();
  return q ? `/jobs?${q}` : "/jobs";
}

function BuilderSelect({ id, name, label, all, options }: { id: string; name: string; label: string; all: string; options: Opt[] }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <select id={id} name={name} defaultValue="" className={field}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** Add a search by pasting a /jobs link, or by picking a few filters. */
export function AddSearchForm({ t, where, categories, grades, types, orgs, langs, exps }: {
  t: string; where: { label: string; options: Opt[] }[]; categories: Opt[]; grades: Opt[]; types: Opt[]; orgs: Opt[]; langs: Opt[]; exps: Opt[];
}) {
  const [state, action, pending] = useActionState(addSearchAction, initial);
  // Without a pasted link, the picked filters go as a link, so every one of them (organization,
  // language, experience, local-only posts included) is saved exactly as on the Jobs page.
  const submit = (form: FormData) => {
    if (!String(form.get("link") ?? "").trim()) form.set("link", builderLink(form));
    return action(form);
  };
  return (
    <form action={submit} className="space-y-4">
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
          <BuilderSelect id="add-org" name="org" label="Organization" all="Any organization" options={orgs} />
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
          <BuilderSelect id="add-category" name="category" label="Category" all="Any category" options={categories} />
          <BuilderSelect id="add-grade" name="grade" label="Grade" all="Any grade" options={grades} />
          <BuilderSelect id="add-type" name="type" label="Contract type" all="Any contract" options={types} />
          <BuilderSelect id="add-exp" name="exp" label="Experience required" all="Any experience" options={exps} />
          <BuilderSelect id="add-lang" name="lang" label="Language in requirements" all="Any language" options={langs} />
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2.5 text-[0.95rem] text-ink">
              <input type="checkbox" name="remote" value="1" className="h-4 w-4 accent-[var(--accent)]" />
              Remote only
            </label>
            <label className="flex items-start gap-2.5 text-[0.95rem] text-ink">
              <input type="checkbox" name="hidelocal" value="1" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
              <span>
                Hide local-only posts
                <span className="block text-xs text-slate">National Officer, General Service and other posts usually open only to nationals or residents</span>
              </span>
            </label>
          </div>
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
      <button disabled={pending} className={secondary}>{pending ? "Opening billing…" : "Manage billing"}</button>
      <Message state={state} />
    </form>
  );
}

/** "Cancel plan": opens Paddle's cancel page for the subscription directly (src/app/cancel-actions.ts). */
export function CancelPlanButton({ t }: { t: string }) {
  const [state, action, pending] = useActionState(cancelPlanAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="t" value={t} />
      <button disabled={pending} className={secondary}>{pending ? "Opening Paddle…" : "Cancel plan"}</button>
      <Message state={state} />
    </form>
  );
}

/** Opens the checkout page with this address's terms (the free trial, or no second one). */
export function RestartPlanButton({ t, label = "Restart daily alerts" }: { t: string; label?: string }) {
  const [state, action, pending] = useActionState(restartPlanAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="t" value={t} />
      <button disabled={pending} className={primary}>{pending ? "Opening…" : label}</button>
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
        <p className="mb-3 text-[0.95rem] text-slate">Stops every email from us.{paying ? " It doesn't cancel your plan: use \"Cancel plan\" for that." : ""}</p>
      )}
      <button disabled={pending} className={secondary}>{pending ? "Saving…" : unsubscribed ? "Turn emails back on" : "Unsubscribe from all emails"}</button>
      <Message state={state} />
    </form>
  );
}

/**
 * "Email me my account link" (/account/login). `intent: "cancel"` is the same request worded for
 * cancelling: the email (worded for it too) links to the account page, where "Cancel plan" cancels.
 */
export function AccountLinkForm({ intent = "manage" }: { intent?: "manage" | "cancel" }) {
  const [state, action, pending] = useActionState(accountLinkAction, initial);
  const id = `login-email-${intent}`;
  if (state.status === "success") return <p role="status" className="rounded-xl bg-remote-bg p-5 text-[1.02rem] leading-relaxed text-ink">{state.message}</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="intent" value={intent} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">Email address</label>
      <input id={id} name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} />
      <button disabled={pending} className={intent === "cancel" ? secondary.replace("px-4 py-2 text-sm", "px-5 py-2.5 text-[0.95rem]") : primary}>
        {pending ? "Sending…" : intent === "cancel" ? "Email me a link to cancel" : "Email me my account link"}
      </button>
      <Message state={state} />
    </form>
  );
}
