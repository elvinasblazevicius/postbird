import Link from "next/link";
import { BILLING_LIVE } from "@/lib/billing/live";
import { EARLY_ACCESS_BUTTON } from "@/lib/early-access-copy";
import { CLOSING_SOON_DAYS } from "@/lib/email-templates";
import { MAX_SAVED_SEARCHES } from "@/lib/saved-searches";
import { siteConfig } from "@/lib/site";
import { TrackedLink } from "./tracking";

/**
 * The one choice every "Get job alerts" button leads to: the free weekly email or paid daily
 * alerts. Daily is the highlighted card (white, yellow outline and button), comes first and leads
 * with the closing-date reminder, the thing only it does; Weekly is the light-blue card next to it
 * (below it on phones, with a link at the top straight to it, so the free option is never missed).
 * `searchLabel`: the search both would follow, named in the Daily card too.
 *
 * `onBand` is for the blue band on the home page; without it the cards sit on a light page.
 */
/** The green tick used in plan lists (as on /pricing). */
function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-remote" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertsChoice({ weeklyHref, trialHref, source, onBand = false, weeklyForm, searchLabel }: { weeklyHref: string; trialHref: string; source: string; onBand?: boolean; weeklyForm?: React.ReactNode; searchLabel?: string | null }) {
  const p = siteConfig.premium;
  // plans[0] is monthly, plans[1] the 3-month plan (site.config.ts).
  const [monthly, quarterly] = p.plans;
  const fromPrice = "perMonth" in quarterly && quarterly.perMonth ? quarterly.perMonth : monthly.price;
  const weekly = (
    <div id={weeklyForm ? "alert-signup" : undefined} className={`on-light flex scroll-mt-24 flex-col gap-2 rounded-[14px] border-[3px] p-4 ${onBand ? "border-[#cbe3fa] bg-[#cbe3fa]" : "border-sky-wash bg-sky-wash sm:p-5"}`}>
      <strong className="text-lg text-ink">Weekly email</strong>
      <ul className="space-y-1.5 text-sm leading-snug text-tint-ink">
        {["Every Monday", "One search", "Free, no card needed"].map((f) => <li key={f} className="flex gap-2"><Check />{f}</li>)}
      </ul>
      {weeklyForm ? <div className="mt-auto pt-1">{weeklyForm}</div> : (
        <Link
          href={weeklyHref}
          className="mt-auto flex min-h-11 items-center justify-center rounded-[10px] border border-brand px-4 py-2.5 text-center text-[0.95rem] font-bold text-accent no-underline hover:bg-paper/60"
        >
          Get the weekly email
        </Link>
      )}
    </div>
  );
  const daily = (
    <div className={`flex flex-col gap-2 rounded-[14px] border-[3px] border-highlight bg-paper p-4 ${onBand ? "" : "sm:p-5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-lg text-ink">{p.name}</strong>
        <span className="rounded-md bg-[#ffe680] px-2 py-0.5 text-[0.8125rem] font-bold text-ink">
          {BILLING_LIVE ? `${p.trialDays} days free` : "Coming soon"}
        </span>
      </div>
      <ul className="space-y-1.5 text-sm leading-snug text-tint-ink">
        <li className="flex gap-2"><Check />{searchLabel ? <span>New matches every day for <strong className="text-ink">{searchLabel}</strong></span> : "New matches every day"}</li>
        <li className="flex gap-2"><Check /><span><strong className="text-ink">Closing-date reminders:</strong> each matching vacancy {CLOSING_SOON_DAYS} days before its published closing date</span></li>
        <li className="flex gap-2"><Check />Up to {MAX_SAVED_SEARCHES} searches</li>
      </ul>
      <p className="text-[0.8125rem] leading-snug text-slate">
        {BILLING_LIVE
          ? `Card required. After the trial, ${quarterly.price} every 3 months (${fromPrice} a month) or ${monthly.price} monthly. Cancel any time.`
          : `${p.trialDays}-day free trial at launch, then ${p.priceSummary}.`}
      </p>
      <TrackedLink
        href={trialHref}
        event="premium_cta_click"
        source={source}
        className="mt-auto flex min-h-11 items-center justify-center rounded-[10px] bg-highlight px-4 py-2.5 text-center text-[0.95rem] font-bold text-ink no-underline shadow-[inset_0_-2px_0_rgb(11_31_58/0.16)] hover:brightness-95"
      >
        {BILLING_LIVE ? "Start free trial" : EARLY_ACCESS_BUTTON}
      </TrackedLink>
    </div>
  );
  return (
    <div>
      {/* Phones: the free option is a screen further down, so say at once that it exists. */}
      <p className={`mb-3 text-sm sm:hidden ${onBand ? "text-white/90" : "text-slate"}`}>
        Prefer free?{" "}
        <a href={weeklyForm ? "#alert-signup" : weeklyHref} className={`font-semibold underline underline-offset-2 ${onBand ? "text-white" : "text-accent"}`}>Get the weekly email, no card needed</a>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
        {daily}
        {weekly}
      </div>
    </div>
  );
}
