import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PremiumInterestForm } from "@/components/token-forms";
import { BILLING_LIVE } from "@/lib/billing/live";
import { getJob } from "@/lib/jobs";
import { describeSearch } from "@/lib/saved-searches";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: BILLING_LIVE ? "Email alerts: free trial" : "Email alerts: early access",
  robots: { index: false, follow: true },
  alternates: { canonical: "/pricing/trial" },
};

type Props = { searchParams: Promise<{ search?: string; remind?: string }> };

/**
 * The visitor clicked an email-alert button. While billing is off (concept
 * test) we say plainly that alerts aren't open yet and record their interest
 * (and what they wanted). Once billing is live this starts the free trial.
 */
export default async function TrialPage({ searchParams }: Props) {
  const p = siteConfig.premium;
  const sp = await searchParams;
  const search = sp.search && sp.search.length <= 400 ? sp.search : null;
  const searchLabel = search ? await describeSearch(search) : null;
  const remindId = sp.remind && /^\d{1,12}$/.test(sp.remind) ? Number(sp.remind) : null;
  const remindJob = remindId ? await getJob(remindId) : null;

  return (
    <>
      <PageHeader
        title={BILLING_LIVE ? `Start your ${p.trialDays}-day free trial` : "Email alerts launch soon"}
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/pricing/trial", label: BILLING_LIVE ? "Free trial" : "Early access" }]}
        intro={
          BILLING_LIVE ? (
            <>
              New vacancies matching your searches, by email, daily or weekly. {p.trialDays} days free, then {p.priceSummary}.
              Cancel any time before the trial ends and you pay nothing.
            </>
          ) : (
          <>
            {p.name} isn&apos;t open yet: we&apos;re checking whether enough people want it before we build billing. Join early access and
            you&apos;ll get one email offering the {p.trialDays}-day free trial when it opens. If we decide not to launch, we&apos;ll tell you
            and delete your address. No card, nothing charged now.
          </>
          )
        }
      />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        {searchLabel ? (
          <p className="mb-6 rounded-xl border border-rule bg-candy-soft p-4 text-ink">
            <span className="font-semibold">Alerts for:</span> {searchLabel}
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
        <PremiumInterestForm source={search ? "search-alert" : remindJob ? "deadline-reminder" : "pricing"} search={search ?? undefined} remindJobId={remindJob ? remindJob.id : undefined} />
      </div>
    </>
  );
}
