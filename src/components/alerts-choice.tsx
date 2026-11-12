import Link from "next/link";
import { BILLING_LIVE } from "@/lib/billing/live";
import { EARLY_ACCESS_BUTTON } from "@/lib/early-access-copy";
import { CLOSING_SOON_DAYS } from "@/lib/email-templates";
import { MAX_SAVED_SEARCHES } from "@/lib/saved-searches";
import { siteConfig } from "@/lib/site";
import { TrackedLink } from "./tracking";

/**
 * The one choice every "Get job alerts" button leads to: the free weekly email or paid daily
 * alerts. Daily is the highlighted card (white, yellow outline and button) and leads with the
 * closing-date reminder, the thing only it does; Weekly is quieter (light blue, outlined button)
 * so the two don't compete. Weekly sits on the left on wide screens; on phones Daily comes first.
 *
 * `onBand` is for the blue band on the home page; without it the cards sit on a light page.
 */
export function AlertsChoice({ weeklyHref, trialHref, source, onBand = false }: { weeklyHref: string; trialHref: string; source: string; onBand?: boolean }) {
  const p = siteConfig.premium;
  // plans[0] is monthly, plans[1] the 3-month plan (site.config.ts).
  const [monthly, quarterly] = p.plans;
  const fromPrice = "perMonth" in quarterly && quarterly.perMonth ? quarterly.perMonth : monthly.price;
  const weekly = (
    <div className={`on-light flex flex-col gap-2 rounded-[14px] border-[3px] p-4 ${onBand ? "border-[#cbe3fa] bg-[#cbe3fa]" : "border-sky-wash bg-sky-wash sm:p-5"}`}>
      <strong className="text-lg text-ink">Weekly email</strong>
      <p className="text-sm leading-snug text-tint-ink">Every Monday, one search. Free, no card needed.</p>
      <Link
        href={weeklyHref}
        className="mt-auto flex min-h-11 items-center justify-center rounded-[10px] border border-brand px-4 py-2.5 text-center text-[0.95rem] font-bold text-accent no-underline hover:bg-paper/60"
      >
        Get the weekly email
      </Link>
    </div>
  );
  const daily = (
    <div className={`flex flex-col gap-2 rounded-[14px] border-[3px] border-highlight bg-paper p-4 max-sm:order-first ${onBand ? "" : "sm:p-5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-lg text-ink">{p.name}</strong>
        <span className="rounded-md bg-[#ffe680] px-2 py-0.5 text-[0.8125rem] font-bold text-ink">
          {BILLING_LIVE ? `${p.trialDays} days free` : "Coming soon"}
        </span>
      </div>
      <p className="text-sm leading-snug text-tint-ink">
        <strong className="text-ink">Closing-date reminders:</strong> each email lists your matching vacancies that close in the next {CLOSING_SOON_DAYS} days. New matches once a day, for up to {MAX_SAVED_SEARCHES} searches.
      </p>
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
  // Weekly comes first in the page (and for the Tab key), as it is seen on wide screens; on phones Daily is shown first.
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {weekly}
      {daily}
    </div>
  );
}
