import type { Metadata } from "next";
import Link from "next/link";
import { AlertExample } from "@/components/alert-example";
import { AlertSignup } from "@/components/alert-signup";
import { AlertWatchStep } from "@/components/alert-watch-step";
import { PageHeader } from "@/components/page-header";
import { PremiumInterestForm } from "@/components/token-forms";
import { BILLING_LIVE } from "@/lib/billing/live";
import { describeSearch, searchFromAlertStep } from "@/lib/saved-searches";
import { siteConfig } from "@/lib/site";

const free = siteConfig.freeWeeklyEmail;

export const metadata: Metadata = {
  title: free
    ? "Free weekly job alerts for UN and international organization vacancies"
    : "Email job alerts for UN and international organization vacancies",
  description: free
    ? "Get a free Monday email with the week's newest vacancies at UN agencies and international organizations. Unsubscribe with one click."
    : "New UN and international organization vacancies by email, filtered by role, organization and location, with each closing date shown.",
  alternates: { canonical: "/alerts" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AlertsPage({ searchParams }: Props) {
  const p = siteConfig.premium;
  // Paid alerts work from saved searches; the free weekly email has none.
  const sp = await searchParams;
  const search = free ? null : searchFromAlertStep(sp);
  const searchLabel = search ? await describeSearch(search) : null;
  return (
    <>
      <PageHeader
        title={free ? "Weekly job alerts" : "Email job alerts"}
        crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: "Job alerts" }]}
        intro={
          free
            ? "A short email every Monday with the newest international vacancies. Free, and you can unsubscribe with one click."
            : `Many international vacancies are open for only a few weeks. Alerts${BILLING_LIVE ? "" : " (launching soon)"} send new matches for the roles, organizations and places you choose. ${p.trialDays}-day free trial, then ${p.priceSummary}.`
        }
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="max-w-xl">
          {free ? (
            <AlertSignup source="alerts-page" />
          ) : (
            <>
              <AlertWatchStep action="/alerts" search={search} searchLabel={searchLabel} chosen={sp.step === "watch"} />
              <div id="alert-signup" className="scroll-mt-24">
                <PremiumInterestForm source="alerts-page" search={search ?? undefined} />
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-rule bg-candy-soft p-6">
          <h2 className="text-xl font-semibold text-ink">What you&apos;ll get</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate">
            {free ? (
              <>
                <li>The week&apos;s newest openings, each linked to the employer&apos;s own website</li>
                <li>Deadlines shown up front, so you can prioritise</li>
                <li>No spam and no sharing of your address</li>
              </>
            ) : (
              p.features.map((f) => <li key={f}>{f}</li>)
            )}
          </ul>
          <p className="mt-5 text-slate">
            Browsing and searching every vacancy stays free. <Link href="/pricing" className="font-medium text-accent hover:underline">See pricing</Link>.
          </p>
          <div className="mt-8">
            <AlertExample />
          </div>
        </div>
      </div>
    </>
  );
}
