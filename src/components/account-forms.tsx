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

/** The "Build a search from filters" fields, in the order a /jobs link writes them. Every one but the keywords may repeat. */
const BUILDER_FIELDS = ["q", "org", "where", "grade", "lang", "exp", "category", "remote", "type", "hidelocal"] as const;

/**
 * The builder's filters as a /jobs link, the same saved search the Jobs page's address gives
 * ("" fields left out; a field chosen several times is repeated), for the "link" field the server reads.
 */
export function builderLink(form: FormData): string {
  const p = new URLSearchParams();
  for (const k of BUILDER_FIELDS) {
    for (const raw of form.getAll(k).slice(0, 10)) {
      const v = String(raw ?? "").trim().slice(0, 120);
      if (v) p.append(k, v);
    }
  }
  const q = p.toString();
  return q ? `/jobs?${q}` : "/jobs";
}

/** A short list where any number can be ticked (a listing matching any of them counts), as pills. */
function Choices({ name, label, options, hint }: { name: string; label: string; options: Opt[]; hint?: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      {hint ? <p className="-mt-1 mb-2 text-xs text-slate">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input type="checkbox" name={name} value={o.value} className="peer sr-only" />
            <span className="inline-block rounded-full border border-rule bg-paper px-3 py-1.5 text-sm text-ink peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Add a search: pick filters (several places, organizations, grades… each; a vacancy matching any
 * of the choices in a field counts), or paste a link from the Jobs page. `placeFields`: the
 * Organization and Where pickers, rendered on the server (their lists come from the database).
 */
export function AddSearchForm({ t, placeFields, categories, grades, types, langs, exps }: {
  t: string; placeFields: React.ReactNode; categories: Opt[]; grades: Opt[]; types: Opt[]; langs: Opt[]; exps: Opt[];
}) {
  const [state, action, pending] = useActionState(addSearchAction, initial);
  // Without a pasted link, the picked filters go as a link, so every one of them is saved exactly as on the Jobs page.
  const submit = (form: FormData) => {
    if (!String(form.get("link") ?? "").trim()) form.set("link", builderLink(form));
    return action(form);
  };
  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="t" value={t} />
      <div>
        <label htmlFor="add-q" className="mb-1.5 block text-sm font-medium text-ink">Keywords</label>
        <input id="add-q" name="q" maxLength={120} placeholder="e.g. data analyst, WASH, communication" className={field} />
        <p className="mt-1 text-xs text-slate">Optional. Vacancies that mention these words.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">{placeFields}</div>
      <details className="rounded-lg border border-rule p-4 [&[open]>summary]:mb-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">More filters: grade, category, contract, languages</summary>
        <div className="space-y-5">
          <Choices name="grade" label="Grade" options={grades} />
          <Choices name="category" label="Category" options={categories} />
          <Choices name="type" label="Contract type" options={types} />
          <Choices name="exp" label="Experience required" options={exps} />
          <Choices name="lang" label="Language in the requirements" options={langs} hint="Vacancies that ask for any of these" />
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-[0.95rem] text-ink">
              <input type="checkbox" name="remote" value="1" className="h-4 w-4 accent-[var(--accent)]" />
              Remote only
            </label>
            <label className="flex items-start gap-2.5 text-[0.95rem] text-ink">
              <input type="checkbox" name="hidelocal" value="1" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
              <span>
                Hide local-only posts
                <span className="block text-xs text-slate">National Officer, General Service, national consultant and other posts open only to nationals or residents</span>
              </span>
            </label>
          </div>
        </div>
      </details>
      <details className="rounded-lg border border-rule p-4 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Or paste a search from the Jobs page</summary>
        <label htmlFor="add-link" className="mb-1.5 block text-sm text-ink">Search and filter on the Jobs page, copy the address from your browser and paste it here. It is used instead of the filters above.</label>
        <input id="add-link" name="link" placeholder="https://…/jobs?q=…" className={field} />
      </details>
      <button disabled={pending} className={primary}>{pending ? "Saving…" : "Save this search"}</button>
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
        <p className="mb-3 text-[0.95rem] text-slate">You&apos;re unsubscribed: we don&apos;t send you any emails.{paying ? " Your plan is still running: see “Cancel your plan” above if you no longer want it." : ""}</p>
      ) : (
        <p className="mb-3 text-[0.95rem] text-slate">Stops every email from us.{paying ? " It doesn't cancel your plan." : ""}</p>
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
