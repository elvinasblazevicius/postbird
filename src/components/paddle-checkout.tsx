"use client";

import siteConfig from "@site-config";

/**
 * The "Start free trial" form when billing is live: plan, email, then Paddle's
 * overlay checkout. Paddle.js loads from Paddle's CDN (as Paddle requires)
 * only once someone starts using the form, never on page load.
 */
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { checkoutDoneAction, startCheckoutAction, type CheckoutState } from "@/app/billing-actions";
import { PADDLE_CLIENT_TOKEN, PADDLE_ENV, PADDLE_PRICE_MONTHLY, PADDLE_PRICE_QUARTERLY } from "@/lib/billing/live";
import { noTrialButton, noTrialLine, planOptions, RENEWING, RENEWS, TAX_LINE, trialButton, trialLine } from "@/lib/early-access-copy";
import { AttributionField, uetEvent } from "./ads";

// ── Paddle.js loader ─────────────────────────────────────────

type PaddleEventData = { name?: string; data?: unknown };
type PaddleGlobal = {
  Environment: { set: (env: string) => void };
  Initialize: (opts: { token: string; eventCallback?: (e: PaddleEventData) => void; checkout?: { settings?: Record<string, unknown> } }) => void;
  Checkout: { open: (opts: Record<string, unknown>) => void; close: () => void };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
let paddlePromise: Promise<PaddleGlobal> | null = null;
/** Paddle.Initialize() may run once per page, so one callback forwards events to whichever form opened the checkout. */
let eventListener: ((e: PaddleEventData) => void) | null = null;

export function loadPaddle(): Promise<PaddleGlobal> {
  if (paddlePromise) return paddlePromise;
  paddlePromise = new Promise<PaddleGlobal>((resolve, reject) => {
    const init = () => {
      const P = window.Paddle;
      if (!P) return reject(new Error("Paddle.js did not load"));
      if (PADDLE_ENV === "sandbox") P.Environment.set("sandbox"); // must come before Initialize
      P.Initialize({
        token: PADDLE_CLIENT_TOKEN,
        eventCallback: (e) => eventListener?.(e),
        checkout: { settings: { displayMode: "overlay", theme: "light", locale: "en" } },
      });
      resolve(P);
    };
    if (window.Paddle) return init();
    const s = document.createElement("script");
    s.src = PADDLE_JS;
    s.async = true;
    s.onload = init;
    s.onerror = () => {
      paddlePromise = null; // allow a retry
      reject(new Error("Paddle.js could not be loaded"));
    };
    document.head.appendChild(s);
  });
  return paddlePromise;
}

// ── Trial form ───────────────────────────────────────────────

/**
 * The server action's answer, plus what this form has learnt from earlier
 * answers: noTrialEmail is an address the server said has had a free trial
 * before (one per person). It is only ever known after the visitor submitted
 * that address, and it keeps the trial copy off the form while the field
 * still holds it, even after a later error.
 */
type FormState = CheckoutState & { noTrialEmail: string | null };

const initial: FormState = { status: "idle", message: "", noTrialEmail: null };

const normEmail = (e: string) => e.trim().toLowerCase();

async function checkoutReducer(prev: FormState, form: FormData): Promise<FormState> {
  const res = await startCheckoutAction({ status: "idle", message: "" }, form);
  let noTrialEmail = prev.noTrialEmail;
  if (res.status === "ready" && !res.trial) noTrialEmail = res.email;
  else if (res.status === "ready" && res.trial && noTrialEmail === res.email) noTrialEmail = null;
  else if (res.status === "error" && res.noTrial) noTrialEmail = normEmail(String(form.get("email") ?? ""));
  return { ...res, noTrialEmail };
}

type Phase = { step: "form" } | { step: "checkout" } | { step: "done"; accountUrl: string | null; trial: boolean };

type Launch = { ref: string; email: string; plan: "monthly" | "quarterly"; transactionId: string | null };

/**
 * Opens Paddle's overlay. With a transactionId (someone who has had a trial
 * before) Paddle uses that transaction's item (the plan without a trial) and
 * custom_data, set by the server; otherwise the catalog price, with its trial,
 * and the reference as customData.
 */
function openPaddleCheckout(c: Launch, h: { source: string; setPhase: (p: Phase) => void; setLoadError: (m: string) => void; cancelled: () => boolean }) {
  const trial = !c.transactionId;
  loadPaddle()
    .then((P) => {
      if (h.cancelled()) return;
      let completed = false;
      eventListener = (e) => {
        if (e.name === "checkout.completed" && !completed) {
          completed = true;
          // "begin_trial" is the Microsoft Ads conversion for a trial; a plan paid straight away is a purchase.
          uetEvent(trial ? "begin_trial" : "purchase", { event_category: "premium", event_label: h.source });
          h.setPhase({ step: "done", accountUrl: null, trial });
          // The webhook usually lands within seconds; until then (or if this
          // checkout didn't create the account) the link comes by email.
          void (async () => {
            for (let i = 0; i < 6; i++) {
              await new Promise((r) => setTimeout(r, 2000));
              const res = await checkoutDoneAction(c.ref).catch(() => null);
              if (res?.accountUrl) return h.setPhase({ step: "done", accountUrl: res.accountUrl, trial });
              if (res?.linked) return;
            }
          })();
        } else if (e.name === "checkout.closed" && !completed) {
          h.setPhase({ step: "form" });
        }
      };
      h.setPhase({ step: "checkout" });
      const settings = { displayMode: "overlay", theme: "light", locale: "en", allowLogout: false };
      P.Checkout.open(
        c.transactionId
          ? { transactionId: c.transactionId, customer: { email: c.email }, settings }
          : {
              items: [{ priceId: c.plan === "quarterly" ? PADDLE_PRICE_QUARTERLY : PADDLE_PRICE_MONTHLY, quantity: 1 }],
              customer: { email: c.email },
              customData: { ref: c.ref },
              settings,
            },
      );
    })
    .catch(() => {
      if (!h.cancelled()) h.setLoadError("The secure checkout couldn't load. Check your connection or ad blocker, then try again.");
    });
}

/**
 * Plan choice (3 months preselected, the best value), email, and
 * "Start 14-day free trial". `compact` is the one-line version used in the
 * small sign-up boxes; `tone="dark"` for coloured backgrounds.
 */
export function TrialCheckoutForm({ source, search, compact = false, tone = "light", watch }: { source: string; search?: string; compact?: boolean; tone?: "light" | "dark"; watch?: React.ReactNode }) {
  const [state, action, pending] = useActionState(checkoutReducer, initial);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  /** Whether the no-trial line was on screen when the form was last submitted. */
  const noticeSeen = useRef(false);
  const dark = tone === "dark";
  const plans = planOptions();
  const [plan, setPlan] = useState<"monthly" | "quarterly">("quarterly");
  const [typedEmail, setTypedEmail] = useState("");
  // The trial end date is worked out in the browser (the visitor's own date and time zone).
  const [trialEnds, setTrialEnds] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(Date.now() + siteConfig.premium.trialDays * 86_400_000);
    const t = setTimeout(() => setTrialEnds(d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })), 0);
    return () => clearTimeout(t);
  }, []);

  // One free trial per person: this address has had a trial before (known only after it was submitted).
  const noTrial = state.noTrialEmail !== null && normEmail(typedEmail) === state.noTrialEmail;
  // A no-trial checkout already prepared for exactly the plan and address on screen.
  const readyTxn = noTrial && state.status === "ready" && !state.trial && state.plan === plan ? state.transactionId : null;

  // Once the server has prepared the checkout, open Paddle's overlay with that reference. Someone
  // who has had a trial before first sees that the plan starts today, and opens it with the button.
  useEffect(() => {
    if (state.status !== "ready" || opened.current === state.ref) return;
    if (!state.trial && !noticeSeen.current) return;
    opened.current = state.ref;
    let cancelled = false;
    openPaddleCheckout(state, { source, setPhase, setLoadError, cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [state, source]);

  const box = dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink";
  if (phase.step === "done") {
    return (
      <div role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${box}`}>
        <p className="font-semibold">{phase.trial ? "Your free trial has started." : "Your plan has started."}</p>
        {phase.accountUrl ? (
          <p className="mt-2">
            Your first alert arrives with the next round of new vacancies.{" "}
            <a href={phase.accountUrl} className={`font-semibold underline ${dark ? "text-white" : "text-accent"}`}>Open your account</a> to add searches or choose daily or weekly emails.
          </p>
        ) : (
          <p className="mt-2">We&apos;ve emailed you the link to your account, where you can add searches, choose daily or weekly emails and manage billing. Your first alert arrives with the next round of new vacancies.</p>
        )}
        <p className="mt-3">
          <Link href="/jobs" className={`font-semibold underline ${dark ? "text-white" : "text-accent"}`}>Keep browsing jobs</Link>
        </p>
      </div>
    );
  }
  if (state.status === "already") {
    return <p role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${box}`}>{state.message}</p>;
  }

  const error = loadError ?? (state.status === "error" ? state.message : null);
  const busy = pending || phase.step === "checkout";
  const field = `w-full min-w-0 rounded-lg border px-4 py-3 text-base focus:outline-none focus:ring-2 ${
    dark ? "border-white/25 bg-white text-ink focus:ring-white/40" : "border-rule bg-paper text-ink focus:border-accent focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
  }`;
  const id = (k: string) => `trial-${k}-${source}`;
  // Never the trial terms for an address that has had a trial before.
  const bold = noTrial ? RENEWING : RENEWS;
  const [before, after = ""] = (noTrial ? noTrialLine(plan) : trialLine(plan, trialEnds)).split(bold);
  const line = { before, after };
  const openReady = () => {
    if (state.status !== "ready" || !readyTxn) return;
    setLoadError(null);
    opened.current = state.ref;
    openPaddleCheckout({ ...state, transactionId: readyTxn }, { source, setPhase, setLoadError, cancelled: () => false });
  };

  return (
    <form
      action={(fd) => {
        setLoadError(null);
        opened.current = null;
        setTypedEmail(String(fd.get("email") ?? ""));
        noticeSeen.current = noTrial;
        action(fd);
      }}
      // Start fetching Paddle.js as soon as someone shows interest, so the checkout opens without a wait.
      onFocus={() => void loadPaddle().catch(() => {})}
      onPointerEnter={() => void loadPaddle().catch(() => {})}
      className="@container w-full"
    >
      <input type="hidden" name="source" value={source} />
      {search ? <input type="hidden" name="search" value={search} /> : null}
      <AttributionField />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {watch ? <div className="mb-6">{watch}</div> : null}
      <fieldset className="mb-4">
        <legend className={`mb-2 block text-sm font-medium ${dark ? "text-white/90" : "text-ink"}`}>Choose your plan</legend>
        <div className={`grid gap-3 ${compact ? "@md:grid-cols-2" : "sm:grid-cols-2"}`}>
          {plans.map((p) => (
            <label
              key={p.value}
              className={`relative flex cursor-pointer flex-col rounded-xl border-2 px-4 pb-3.5 pt-4 transition-colors ${
                dark
                  ? "border-white/25 text-white has-[:checked]:border-[var(--highlight)] has-[:checked]:bg-white/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70"
                  : "border-rule bg-paper text-ink hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--rule))] has-[:checked]:border-accent has-[:checked]:bg-[color-mix(in_srgb,var(--accent)_6%,white)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
              }`}
            >
              {p.best ? (
                <span className="absolute -top-3 left-4 rounded-full bg-remote px-2.5 py-0.5 text-xs font-semibold tracking-wide text-white shadow-sm">Best value</span>
              ) : null}
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.label}</span>
                <input type="radio" name="plan" value={p.value} defaultChecked={p.best} onChange={() => setPlan(p.value)} className={`h-4 w-4 ${dark ? "accent-[var(--highlight)]" : "accent-[var(--accent)]"}`} />
              </span>
              <span className="mt-1.5 flex items-baseline gap-1">
                <span className="font-display text-3xl font-semibold leading-none">{p.price}</span>
                <span className={`text-sm ${dark ? "text-white/75" : "text-slate"}`}>{p.per}</span>
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {p.perMonth ? <span className={`font-semibold ${dark ? "text-white" : "text-remote"}`}>{p.perMonth}</span> : null}
                {p.note ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dark ? "bg-white/15 text-white" : "bg-remote-bg text-remote"}`}>{p.note}</span>
                ) : null}
                {!p.perMonth && !p.note ? <span className={dark ? "text-white/75" : "text-slate"}>{p.detail}, cancel any time</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={id("email")} className={`mb-1.5 block text-sm font-medium ${dark ? "text-white/90" : "text-ink"}`}>Email address</label>
      <input id={id("email")} name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} onChange={(e) => setTypedEmail(e.target.value)} />
      {/* The terms come before the button, so they are read before starting. */}
      <p className={`mt-3 text-sm ${dark ? "text-white/85" : "text-slate"}`} aria-live="polite">
        {line.before}<strong className={dark ? "text-white" : "text-ink"}>{bold}</strong>{line.after} {TAX_LINE}{" "}
        <Link href="/terms#subscriptions" className="underline">Subscription terms</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy</Link>
      </p>
      <div className="mt-3">
        {/* With a no-trial checkout ready for this plan and address, the button opens it; otherwise it submits. */}
        <button
          type={readyTxn ? "button" : "submit"}
          onClick={readyTxn ? openReady : undefined}
          disabled={busy}
          className={`w-full rounded-lg px-5 py-3 text-base font-semibold disabled:opacity-60 ${dark ? "bg-highlight text-ink hover:brightness-95" : "bg-brand text-white hover:bg-accent"}`}
        >
          {pending ? "Preparing…" : phase.step === "checkout" ? "Checkout open…" : noTrial ? noTrialButton : trialButton}
        </button>
      </div>
      {error ? <p role="alert" className={`mt-2 text-sm ${dark ? "text-[#ffd7d7]" : "text-[#9b1c1c]"}`}>{error}</p> : null}
      <ul className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs ${dark ? "text-white/70" : "text-slate"}`}>
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          Secure checkout by Paddle
        </li>
        {noTrial ? null : (
          <li className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            $0 today, nothing charged if you cancel during the trial
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          Cancel any time from your account
        </li>
      </ul>
    </form>
  );
}

/**
 * Paddle's "default payment link" page: Paddle sends customers here (with
 * ?_ptxn=…) to pay an open invoice or update their card. Paddle.js opens the
 * right checkout by itself once initialized.
 */
export function PaddlePaymentLink() {
  const [state, setState] = useState<"loading" | "open" | "error" | "slow">("loading");
  useEffect(() => {
    eventListener = (e) => {
      if (e.name === "checkout.loaded") setState("open");
    };
    loadPaddle().catch(() => setState("error"));
    // If nothing has opened after a few seconds, say what to do instead of waiting forever.
    const t = setTimeout(() => setState((s) => (s === "loading" ? "slow" : s)), 8000);
    return () => clearTimeout(t);
  }, []);
  if (state === "error") {
    return <p role="alert" className="text-[#9b1c1c]">The secure checkout couldn&apos;t load. Check your connection or ad blocker, then reload this page.</p>;
  }
  if (state === "slow") return <NoCheckoutHere />;
  return <p className="text-slate">{state === "open" ? "The secure Paddle checkout is open." : "Opening the secure Paddle checkout…"}</p>;
}

/** Shown when this page has no checkout to open (no Paddle transaction in the link, or it didn't open). */
export function NoCheckoutHere() {
  return (
    <div role="status" className="space-y-3 text-ink">
      <p>There&apos;s no payment to open from this link. Payment links come from Paddle&apos;s emails and work for a limited time.</p>
      <p>
        To start email alerts, go to the <Link href="/pricing/trial" className="font-semibold text-accent underline">free trial page</Link>. To update your card or
        see your plan, open your account (<Link href="/account/login" className="font-semibold text-accent underline">get your account link</Link>).
      </p>
    </div>
  );
}
