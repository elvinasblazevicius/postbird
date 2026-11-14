import type { Metadata } from "next";
import Link from "next/link";
import { AlertExample } from "@/components/alert-example";
import { WatchFields } from "@/components/alert-watch-step";
import { FollowsLabel } from "@/components/follows-label";
import { CLOSING_SOON_DAYS } from "@/lib/email-templates";
import { CoverageLine } from "@/components/coverage-line";
import { MAX_SAVED_SEARCHES } from "@/lib/saved-searches";
import { PageHeader } from "@/components/page-header";
import { PremiumInterestForm } from "@/components/token-forms";
import { BILLING_LIVE } from "@/lib/billing/live";
import { employersPhrase, euListingsOpen } from "@/lib/eu-claim";
import { getJob } from "@/lib/jobs";
import { describeSearch, searchFromAlertStep } from "@/lib/saved-searches";
import { INDEPENDENCE_NOTE, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

/** The description names the EU only while EU institutions have open vacancies here (see src/lib/eu-claim.ts). */
export async function generateMetadata(): Promise<Metadata> {
  const employers = employersPhrase(await euListingsOpen());
  return {
    title: BILLING_LIVE ? "Daily alerts: free trial" : "Daily alerts: early access",
    description: BILLING_LIVE
      ? `Start a ${siteConfig.premium.trialDays}-day free trial of ${siteConfig.name} daily alerts: new ${employers} vacancies that match your searches, by email. Then ${siteConfig.premium.priceSummary}; cancel any time.`
      : `Join early access to ${siteConfig.name} daily alerts: new ${employers} vacancies that match your searches, by email. Nothing is charged now.`,
    robots: { index: false, follow: true },
    alternates: { canonical: "/pricing/trial" },
  };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The visitor clicked an email-alert button. While billing is off (concept
 * test) we say plainly that alerts aren't open yet and record their interest
 * (and what they wanted). Once billing is live this starts the free trial.
 */
export default async function TrialPage({ searchParams }: Props) {
  const p = siteConfig.premium;
  const sp = await searchParams;
  const search = searchFromAlertStep(sp);
  const searchLabel = search ? await describeSearch(search) : null;
  // "Start over with other keywords" from a carried search: the keyword field opens, and the sign-up still counts as from a search.
  const restart = sp.restart === "search";
  const remind = typeof sp.remind === "string" ? sp.remind : "";
  const remindId = /^\d{1,12}$/.test(remind) ? Number(remind) : null;
  const remindJob = remindId ? await getJob(remindId) : null;

  return (
    <>
      <PageHeader
        compact={BILLING_LIVE}
        title={BILLING_LIVE ? `Start your ${p.trialDays}-day free trial` : `${p.name} launch soon`}
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/pricing/trial", label: BILLING_LIVE ? "Free trial" : "Early access" }]}
        intro={
          BILLING_LIVE ? (
            <>
              New matching vacancies by email every day, and a reminder {CLOSING_SOON_DAYS} days before each published closing date. {p.trialDays} days free,
              then {p.priceSummary}.
            </>
          ) : (
          <>
            {p.name} aren&apos;t open yet: we&apos;re checking whether enough people want them before we build billing. Join early access and
            you&apos;ll get one email offering the {p.trialDays}-day free trial when it opens. If we decide not to launch, we&apos;ll tell you
            and delete your address. No card, nothing charged now.
          </>
          )
        }
        note={BILLING_LIVE ? INDEPENDENCE_NOTE : undefined}
      />
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-12">
        <CoverageLine className="mb-6 max-sm:hidden" />
        {BILLING_LIVE ? (
          // Phones: the header's intro is hidden (compact), so the offer in one line, with the form right below.
          <p className="mb-5 text-[0.95rem] text-ink sm:hidden">
            New matches every day and a reminder {CLOSING_SOON_DAYS} days before each published closing date. {p.trialDays} days free.
          </p>
        ) : null}
        {remindJob ? (
          <div className="mb-6 rounded-xl border border-rule bg-candy-soft p-4 text-ink">
            <p>
              <span className="font-semibold">Deadline reminder for:</span> {remindJob.title}
              {remindJob.org_name ? ` (${remindJob.org_name})` : ""}
            </p>
            <p className="mt-2 text-[0.95rem]">
              {BILLING_LIVE
                ? "Deadline reminders by email aren't available yet."
                : <>Email reminders are part of {p.name.toLowerCase()}, so we can&apos;t send this one yet.</>} To be sure you don&apos;t miss it,{" "}
              <a href={`/api/calendar/${remindJob.id}`} rel="nofollow" className="font-semibold text-accent underline">add the deadline to your calendar</a>.
            </p>
          </div>
        ) : null}
        <div id="alert-signup" className="scroll-mt-24">
          <PremiumInterestForm
            source={search || restart ? "search-alert" : remindJob ? "deadline-reminder" : "pricing"}
            search={search ?? undefined}
            remindJobId={remindJob ? remindJob.id : undefined}
            watch={
              // Only the keywords here (fewer steps before the trial): a search the visitor came from is kept
              // instead, and more searches (organization, place, grade) are added on the account page.
              searchLabel ? (
                <p className="rounded-xl border border-sky-rule bg-sky-wash px-4 py-3 text-[0.95rem] text-ink">
                  Your daily alerts will follow your search: <strong>{searchLabel}</strong>. You can add up to {MAX_SAVED_SEARCHES} searches after signing up.{" "}
                  <a href="/pricing/trial?restart=search#alert-signup" className="font-medium text-accent underline underline-offset-2">Start over with other keywords</a>
                </p>
              ) : (
                // Folded: the plan, the address and the button come first; keywords are one tap away.
                <details className="group rounded-xl border border-rule" open={restart}>
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 px-4 py-2 text-[0.95rem] text-ink [&::-webkit-details-marker]:hidden">
                    <span>Alerts follow: <FollowsLabel initial="all new vacancies" /></span>
                    <span className="font-medium text-accent underline underline-offset-2 group-open:hidden">Add keywords</span>
                  </summary>
                  <div className="space-y-1.5 border-t border-rule px-4 pb-4 pt-3">
                    <WatchFields part="keywords" search={null} searchLabel={null} />
                    <p className="text-sm text-slate">Leave empty for every new vacancy. Add up to {MAX_SAVED_SEARCHES} searches later.</p>
                  </div>
                </details>
              )
            }
          />
        </div>
        {siteConfig.freeWeeklyEmail ? (
          <p className="mt-6 rounded-xl border border-rule p-4 text-[0.95rem] text-ink">
            Once a week is enough?{" "}
            <Link href={`/alerts${search ? `?search=${encodeURIComponent(search)}` : ""}#alert-signup`} className="font-semibold text-accent underline">
              Get the free weekly email
            </Link>{" "}
            for one search instead. No card needed.
          </p>
        ) : null}
        <div className="mt-12">
          <AlertExample heading="What a daily alert looks like" search={search} />
        </div>
      </div>
    </>
  );
}
