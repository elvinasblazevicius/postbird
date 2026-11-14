"use client";

import siteConfig from "@site-config";

/**
 * The "Start free trial" form when billing is live: plan, email, then Paddle's
 * overlay checkout. Paddle.js loads from Paddle's CDN (as Paddle requires)
 * only once someone starts using the form, never on page load (see usePaddleWarmup).
 */
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { checkoutDoneAction, continueCheckoutAction, metaCheckoutAction, startCheckoutAction, type CheckoutState } from "@/app/billing-actions";
import { PADDLE_CLIENT_TOKEN, PADDLE_ENV, PADDLE_PRICE_MONTHLY, PADDLE_PRICE_QUARTERLY } from "@/lib/billing/live";
import {
  CARD_STATEMENT_LINE, CHECK_INBOX_FIRST, CONFIRM_FIRST_DONE, NO_TRIAL_RENEWAL_ACK, noTrialButton, noTrialLine, ONE_TRIAL_SHORT, planOptions, planPriceNumber, RENEWING, RENEWS,
  TAX_LINE, TRIAL_CONFIRM_NOTE, TRIAL_RENEWAL_ACK, TRIAL_TERMS, trialButton, trialSummary,
} from "@/lib/early-access-copy";
import { adConversion, AttributionField, consentRegion, metaMatchValue } from "./ads";

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

const initial: CheckoutState = { status: "idle", message: "" };

/** confirmFirst: the address still has to be confirmed from the inbox before alerts start (the public trial form). */
type Phase = { step: "form" } | { step: "checkout" } | { step: "done"; accountUrl: string | null; trial: boolean; confirmFirst: boolean };

type Launch = { ref: string; email: string; plan: "monthly" | "quarterly"; transactionId: string | null; confirmFirst: boolean };

/**
 * Opens Paddle's overlay. With a transactionId (the continue page, for an
 * address that has had a trial before) Paddle uses that transaction's item
 * (the plan without a trial) and custom_data, set by the server; otherwise the
 * catalog price, with its trial, and the reference as customData.
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
          // The same conversion from the server (Meta Conversions API), with this event's id; before adConversion, which starts a new id.
          void metaCheckoutAction(c.ref, trial, metaMatchValue()).catch(() => {});
          // "begin_trial" is the Microsoft Ads conversion for a trial; a plan paid straight away is a purchase
          // (Meta: StartTrial / Purchase, the purchase with the plan's US-dollar price from site.config.ts).
          adConversion(trial ? "begin_trial" : "purchase", { event_category: "premium", event_label: h.source },
            trial ? undefined : { value: planPriceNumber(c.plan === "quarterly" ? "quarter" : "month"), currency: "USD" });
          const confirmFirst = c.confirmFirst;
          h.setPhase({ step: "done", accountUrl: null, trial, confirmFirst });
          // An address that still has to be confirmed gets its account link by email after confirming.
          // Otherwise the webhook usually lands within seconds; until then the link comes by email.
          if (!confirmFirst) {
            void (async () => {
              for (let i = 0; i < 6; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                const res = await checkoutDoneAction(c.ref).catch(() => null);
                if (res?.accountUrl) return h.setPhase({ step: "done", accountUrl: res.accountUrl, trial, confirmFirst });
                if (res?.linked) return;
              }
            })();
          }
        } else if (e.name === "checkout.closed" && !completed) {
          h.setPhase({ step: "form" });
        }
      };
      h.setPhase({ step: "checkout" });
      // allowLogout: false keeps the email the server checked; the webhook also checks the Paddle customer's email.
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

/** After checkout: the trial (or plan) has started; the account link, or where it will come from. */
function DoneBox({ phase, dark }: { phase: Extract<Phase, { step: "done" }>; dark: boolean }) {
  if (phase.confirmFirst) {
    // The public form: the address isn't proven yet, so alerts wait for its confirmation.
    return (
      <div role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink"}`}>
        <p className="font-semibold">{CHECK_INBOX_FIRST}</p>
        <p className="mt-2">{phase.trial ? `Your ${siteConfig.premium.trialDays}-day trial is running now. ${CONFIRM_FIRST_DONE}` : "Your plan has started."}</p>
        <p className="mt-3">
          <Link href="/jobs" className={`font-semibold underline ${dark ? "text-white" : "text-accent"}`}>Keep browsing jobs</Link>
        </p>
      </div>
    );
  }
  return (
    <div role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink"}`}>
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

/** The plan choice (3 months preselected, the best value). */
function PlanChoice({ dark, compact, plan, setPlan, locked = false }: { dark: boolean; compact: boolean; plan: "monthly" | "quarterly"; setPlan: (p: "monthly" | "quarterly") => void; locked?: boolean }) {
  const plans = planOptions();
  return (
    <fieldset className="mb-4" disabled={locked}>
      <legend className={`mb-2 block text-sm font-medium ${dark ? "text-white/90" : "text-ink"}`}>Choose your plan</legend>
      {/* Room above each card for the "Best value" badge that sits on its top edge (also when the cards stack on phones). */}
      {/* Side by side, also on phones (two short cards rather than a screen of stacked ones). */}
      <div className={`grid gap-x-2 gap-y-5 pt-3 sm:gap-x-3 ${compact ? "@md:grid-cols-2" : "grid-cols-2"}`}>
        {plans.map((p) => (
          <label
            key={p.value}
            className={`relative flex cursor-pointer flex-col rounded-xl border-2 px-3 pb-3 pt-4 transition-colors sm:px-4 sm:pb-3.5 ${
              dark
                ? "border-white/25 text-white has-[:checked]:border-[var(--highlight)] has-[:checked]:bg-white/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70"
                : "border-rule bg-paper text-ink hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--rule))] has-[:checked]:border-accent has-[:checked]:bg-[color-mix(in_srgb,var(--accent)_6%,white)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
            }`}
          >
            {p.best ? (
              <span className="absolute -top-3 left-3 rounded-full sm:left-4 bg-remote px-2.5 py-0.5 text-xs font-semibold tracking-wide text-white shadow-sm">Best value</span>
            ) : null}
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{p.label}</span>
              <input type="radio" name="plan" value={p.value} checked={plan === p.value} onChange={() => setPlan(p.value)} className={`h-4 w-4 ${dark ? "accent-[var(--highlight)]" : "accent-[var(--accent)]"}`} />
            </span>
            <span className="mt-1.5 flex flex-wrap items-baseline gap-x-1">
              <span className="font-display text-[1.6rem] font-semibold leading-none sm:text-3xl">{p.price}</span>
              <span className={`text-sm ${dark ? "text-white/90" : "text-slate"}`}>{p.per}</span>
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {p.perMonth ? <span className={`font-semibold ${dark ? "text-white" : "text-remote"}`}>{p.perMonth}</span> : null}
              {p.note ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dark ? "bg-white/15 text-white" : "bg-remote-bg text-remote"}`}>{p.note}</span>
              ) : null}
              {!p.perMonth && !p.note ? <span className={dark ? "text-white/90" : "text-slate"}>{p.detail}, cancel any time</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The terms, then the required "renews automatically" checkbox (the browser won't submit the form
 * without it; the button stays enabled; its label is the consent), then the button. With a trial:
 * one summary line ("$0 today · trial ends … · then … until you cancel"), the renewal and
 * cancellation facts in view (and, on the public form, that the address must be confirmed), and
 * the smaller print (tax, one trial per address, card statement) in a "Details" disclosure.
 * `confirmNote`: the public trial form, where the address still has to be confirmed (TRIAL_CONFIRM_NOTE).
 */
function TermsAndButton({ dark, trial, plan, trialEnds, busy, label, type = "submit", onClick, confirmNote = false }: {
  dark: boolean; trial: boolean; plan: "monthly" | "quarterly"; trialEnds: string | null; busy: boolean; label: string; type?: "submit" | "button"; onClick?: () => void; confirmNote?: boolean;
}) {
  const ackId = useId();
  const muted = dark ? "text-white/85" : "text-slate";
  const strong = dark ? "text-white" : "text-ink";
  const links = (
    <>
      <Link href="/terms#subscriptions" className="underline">Subscription terms</Link> ·{" "}
      <Link href="/privacy" className="underline">Privacy</Link> ·{" "}
      <Link href="/refunds" className="underline">Refunds</Link>
    </>
  );
  // Bold "renews automatically" / "renewing automatically" wherever the terms say it.
  const bolded = (text: string, bold: string) => {
    const [before, after = ""] = text.split(bold);
    return <>{before}<strong className={strong}>{bold}</strong>{after}</>;
  };
  return (
    <>
      {/* The terms come before the button, so they are read before starting. */}
      {trial ? (
        <>
          <p className={`mt-3 text-[0.95rem] font-semibold ${strong}`} aria-live="polite">{trialSummary(plan, trialEnds)}</p>
          <p className={`mt-1 text-sm ${muted}`}>
            {bolded(TRIAL_TERMS, RENEWS)}{confirmNote ? ` ${TRIAL_CONFIRM_NOTE}` : ""} {links}
          </p>
        </>
      ) : (
        <p className={`mt-3 text-sm ${muted}`} aria-live="polite">
          {bolded(noTrialLine(plan), RENEWING)} {links}
        </p>
      )}
      <details className={`group/details mt-2 text-xs ${dark ? "text-white/90" : "text-slate"}`}>
        <summary className={`inline-flex cursor-pointer list-none items-center gap-1 py-1 font-medium underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden ${dark ? "text-white" : "text-accent"}`}>
          Details
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 transition-transform group-open/details:rotate-180" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>{TAX_LINE}</li>
          {trial ? <li>{ONE_TRIAL_SHORT}</li> : null}
          <li>{CARD_STATEMENT_LINE}</li>
        </ul>
      </details>
      <div className="mt-3 flex items-start gap-2">
        <input
          id={ackId}
          name="renewal_ack"
          type="checkbox"
          required
          className={`mt-0.5 h-4 w-4 shrink-0 ${dark ? "accent-[var(--highlight)]" : "accent-[var(--accent)]"}`}
        />
        <label htmlFor={ackId} className={`text-sm ${dark ? "text-white/90" : "text-ink"}`}>{trial ? TRIAL_RENEWAL_ACK : NO_TRIAL_RENEWAL_ACK}</label>
      </div>
      <div className="mt-3">
        <button
          type={type}
          onClick={onClick}
          disabled={busy}
          className={`w-full rounded-lg px-5 py-3 text-base font-semibold disabled:opacity-60 ${dark ? "bg-highlight text-ink hover:brightness-95" : "bg-brand text-white hover:bg-accent"}`}
        >
          {label}
        </button>
      </div>
    </>
  );
}

/**
 * When to start fetching Paddle.js ahead of the checkout. Where the cookie choice is asked first
 * (or when the region is unknown, the same rule as in ./ads) only once the visitor
 * clicks into the email field or submits (submitting loads it anyway); elsewhere also on pointing
 * at the form. Returns the handlers for the form and for the email field.
 */
function usePaddleWarmup() {
  const [eager, setEager] = useState(false);
  useEffect(() => {
    let live = true;
    void consentRegion().then((required) => {
      if (live) setEager(!required);
    });
    return () => {
      live = false;
    };
  }, []);
  const warm = () => void loadPaddle().catch(() => {});
  return {
    form: eager ? { onFocus: warm, onPointerEnter: warm } : {},
    email: { onFocus: warm },
  };
}

/** The trial's last day (or `daysBefore` it: the reminder email), worked out in the browser (the visitor's own date and time zone). */
function useTrialEnds(daysBefore = 0) {
  const [trialEnds, setTrialEnds] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(Date.now() + (siteConfig.premium.trialDays - daysBefore) * 86_400_000);
    const t = setTimeout(() => setTrialEnds(d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })), 0);
    return () => clearTimeout(t);
  }, [daysBefore]);
  return trialEnds;
}

/**
 * Plan choice (3 months preselected, the best value), email, and
 * "Start 14-day free trial". `compact` is the one-line version used in the
 * small sign-up boxes; `tone="dark"` for coloured backgrounds. A confirmed
 * address, or one that has or had a plan, gets "check your inbox" and the next
 * step by email, the same reply whichever it is.
 */
export function TrialCheckoutForm({ source, search, compact = false, tone = "light", watch }: { source: string; search?: string; compact?: boolean; tone?: "light" | "dark"; watch?: React.ReactNode }) {
  const [state, action, pending] = useActionState(startCheckoutAction, initial);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const dark = tone === "dark";
  const [plan, setPlan] = useState<"monthly" | "quarterly">("quarterly");
  const trialEnds = useTrialEnds();
  const reminder = useTrialEnds(3);
  const warmup = usePaddleWarmup();

  // Once the server has prepared the checkout, open Paddle's overlay with that reference.
  useEffect(() => {
    if (state.status !== "ready" || opened.current === state.ref) return;
    opened.current = state.ref;
    let cancelled = false;
    openPaddleCheckout(state, { source, setPhase, setLoadError, cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [state, source]);

  const box = dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink";
  if (phase.step === "done") return <DoneBox phase={phase} dark={dark} />;
  if (state.status === "inbox") {
    return <p role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${box}`}>{state.message}</p>;
  }

  const error = loadError ?? (state.status === "error" ? state.message : null);
  const busy = pending || phase.step === "checkout";
  const field = `w-full min-w-0 rounded-lg border px-4 py-3 text-base focus:outline-none focus:ring-2 ${
    dark ? "border-white/25 bg-white text-ink focus:ring-white/40" : "border-rule bg-paper text-ink focus:border-accent focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
  }`;
  const id = (k: string) => `trial-${k}-${source}`;

  return (
    <form
      action={(fd) => {
        setLoadError(null);
        // The same address again after closing the checkout: reopen the one already prepared
        // (the server hands the same visitor that one back, and prepares no second one for the
        // same address for 5 minutes).
        if (state.status === "ready" && String(fd.get("email") ?? "").trim().toLowerCase() === state.email) {
          openPaddleCheckout({ ...state, plan }, { source, setPhase, setLoadError, cancelled: () => false });
          return;
        }
        opened.current = null;
        action(fd);
      }}
      // Start fetching Paddle.js once someone shows interest, so the checkout opens without a wait (see usePaddleWarmup).
      {...warmup.form}
      className="@container w-full"
    >
      <input type="hidden" name="source" value={source} />
      {search ? <input type="hidden" name="search" value={search} /> : null}
      <AttributionField />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {watch ? <div className="mb-6">{watch}</div> : null}
      <PlanChoice dark={dark} compact={compact} plan={plan} setPlan={setPlan} />
      <label htmlFor={id("email")} className={`mb-1.5 block text-sm font-medium ${dark ? "text-white/90" : "text-ink"}`}>Email address</label>
      <input id={id("email")} name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={field} {...warmup.email} />
      <TermsAndButton dark={dark} trial confirmNote plan={plan} trialEnds={trialEnds} busy={busy} label={pending ? "Preparing…" : phase.step === "checkout" ? "Checkout open…" : trialButton} />
      {error ? <p role="alert" className={`mt-2 text-sm ${dark ? "text-[#ffd7d7]" : "text-[#9b1c1c]"}`}>{error}</p> : null}
      <ul className={`mt-3 space-y-1 text-[0.8125rem] ${dark ? "text-white/90" : "text-slate"}`}>
        <li className="flex items-start gap-1.5">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          Next: your card in Paddle&apos;s secure checkout. Nothing is charged today.
        </li>
        <li className="flex items-start gap-1.5">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          {reminder ? `We email you on ${reminder}, 3 days before your trial ends.` : "We email you 3 days before your trial ends."}
        </li>
        <li className="flex items-start gap-1.5">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          Full refund if you ask within 14 days of any charge, no questions asked.
        </li>
      </ul>
    </form>
  );
}

/**
 * The continue page (/account/continue, from the emailed checkout link): the
 * plan choice and the terms for this address (`trial` false: it has had a free
 * trial before), then Paddle Checkout. The button uses the link up; once the
 * checkout is prepared, the plan is fixed and the button reopens the same checkout.
 */
export function ContinueCheckoutForm({ token, trial, defaultPlan }: { token: string; trial: boolean; defaultPlan: "monthly" | "quarterly" }) {
  const [state, action, pending] = useActionState(continueCheckoutAction, initial);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const [plan, setPlan] = useState<"monthly" | "quarterly">(defaultPlan);
  const trialEnds = useTrialEnds();
  const source = "checkout-link";
  // No email field here: in consent regions Paddle.js loads when the button is pressed.
  const warmup = usePaddleWarmup();

  // The terms were on screen when the button was pressed, so the checkout opens at once.
  useEffect(() => {
    if (state.status !== "ready" || opened.current === state.ref) return;
    opened.current = state.ref;
    let cancelled = false;
    openPaddleCheckout(state, { source, setPhase, setLoadError, cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [state]);

  if (phase.step === "done") return <DoneBox phase={phase} dark={false} />;
  const ready = state.status === "ready" ? state : null;
  const reopen = () => {
    if (!ready) return;
    setLoadError(null);
    openPaddleCheckout(ready, { source, setPhase, setLoadError, cancelled: () => false });
  };
  const error = loadError ?? (state.status === "error" ? state.message : null);
  const busy = pending || phase.step === "checkout";
  const label = pending ? "Preparing…" : phase.step === "checkout" ? "Checkout open…" : trial ? trialButton : noTrialButton;

  return (
    <form
      action={(fd) => {
        setLoadError(null);
        action(fd);
      }}
      {...warmup.form}
      className="@container w-full"
    >
      <input type="hidden" name="token" value={token} />
      <PlanChoice dark={false} compact={false} plan={ready ? ready.plan : plan} setPlan={setPlan} locked={Boolean(ready)} />
      {ready ? <input type="hidden" name="plan" value={ready.plan} /> : null}
      <TermsAndButton
        dark={false}
        trial={ready ? ready.trial : trial}
        plan={ready ? ready.plan : plan}
        trialEnds={trialEnds}
        busy={busy}
        label={label}
        type={ready ? "button" : "submit"}
        onClick={ready ? reopen : undefined}
      />
      {error ? <p role="alert" className="mt-2 text-sm text-[#9b1c1c]">{error}</p> : null}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        Secure checkout by Paddle · Cancel any time from your account
      </p>
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
        To start daily alerts, go to the <Link href="/pricing/trial" className="font-semibold text-accent underline">free trial page</Link>. To update your card or
        see your plan, open your account (<Link href="/account/login" className="font-semibold text-accent underline">get your account link</Link>).
      </p>
    </div>
  );
}
