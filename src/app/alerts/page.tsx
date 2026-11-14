import type { Metadata } from "next";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertExample } from "@/components/alert-example";
import { AlertsChoice } from "@/components/alerts-choice";
import { WatchFields } from "@/components/alert-watch-step";
import { PageHeader } from "@/components/page-header";
import { FreeWeeklyForm, PremiumInterestForm } from "@/components/token-forms";
import { BILLING_LIVE } from "@/lib/billing/live";
import { isMetaVisit, META_VISIT_QUERY } from "@/lib/ad-visit";
import { describeSearch, searchFromAlertStep } from "@/lib/saved-searches";
import { INDEPENDENCE_NOTE, siteConfig } from "@/lib/site";

const free = siteConfig.freeWeeklyEmail;

const TITLE = free
  ? "Free weekly job email for UN and international organization vacancies"
  : "Email job alerts for UN and international organization vacancies";
const DESCRIPTION = free
  ? "A free Monday email with the past week's new vacancies at UN agencies, NGOs and other international organizations that match your search. No card, no account, one-click unsubscribe."
  : "New UN, NGO and international organization vacancies by email, filtered by role, organization and location, with the closing date whenever the employer publishes one.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/alerts" },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AlertsPage({ searchParams }: Props) {
  const p = siteConfig.premium;
  const sp = await searchParams;
  // Without the free weekly email, the trial page is the one place to start alerts once billing is live (same query string).
  if (BILLING_LIVE && !free) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, x);
    redirect(`/pricing/trial${qs.size ? `?${qs}` : ""}`);
  }
  const search = searchFromAlertStep(sp);
  // Visitors from Meta ads came for the free weekly email; the paid daily plan isn't shown to them on this page
  // (Employment ads into job-scam-prone markets: no paid offer next to vacancies). /pricing still has it.
  const fromMeta = isMetaVisit(sp);
  const searchLabel = search ? await describeSearch(search) : null;
  if (free) {
    const trialHref = `/pricing/trial${search ? `?search=${encodeURIComponent(search)}` : ""}`;
    return (
      <>
        <PageHeader
          title={fromMeta ? "Free weekly job email" : "Get job alerts"}
          crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: fromMeta ? "Weekly email" : "Job alerts" }]}
          intro={fromMeta
            ? "Every Monday, the past week's new vacancies at UN agencies, NGOs and other international organizations that match your search. Free, with no card and no account. If nothing new matches, we don't send anything that week."
            : "Pick a search once. We send you the new vacancies at UN agencies, NGOs and other international organizations that match it: every Monday for free, or once a day with daily alerts. When there is nothing to tell you, we don't email."}
          note={INDEPENDENCE_NOTE}
        />
        {fromMeta ? null : (
          <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6" aria-labelledby="choice-h">
            <h2 id="choice-h" className="sr-only">Weekly email or daily alerts</h2>
            {searchLabel ? (
              <p className="mb-4 rounded-xl border border-sky-rule bg-sky-wash px-4 py-3 text-[0.95rem] text-ink">
                Your alerts will follow the search you just made: <strong>{searchLabel}</strong>. Nothing to search again.{" "}
                <Link href="/alerts" className="font-medium text-accent underline underline-offset-2">Start from scratch</Link>
              </p>
            ) : null}
            <div>
              <AlertsChoice
                weeklyHref="#alert-signup"
                trialHref={trialHref}
                source={search ? "alerts-daily-search" : "alerts-daily"}
                weeklyForm={<FreeWeeklyForm compact source={search ? "search-weekly" : "alerts-page"} search={search ?? undefined} />}
              />
            </div>
          </section>
        )}
        {fromMeta ? null : (
          // One sign-up per plan, in its card above: here only what the emails look like.
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <div className="max-w-xl">
              <AlertExample heading="What the weekly email looks like" kind="weekly" />
            </div>
          </div>
        )}
        {fromMeta ? (
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
          <section className="max-w-xl" aria-labelledby="free-h">
            <h2 id="free-h" className={fromMeta ? "sr-only" : "mb-4 text-xl font-semibold text-ink"}>{fromMeta ? "Sign up for the free weekly email" : "Weekly email: free, every Monday"}</h2>
            <div id="alert-signup" className="scroll-mt-24">
              <FreeWeeklyForm
                source={search ? "search-weekly" : "alerts-page"}
                search={search ?? undefined}
                searchLabel={searchLabel}
                watch={<WatchFields fold search={search} searchLabel={searchLabel} resetHref={fromMeta ? `/alerts?${META_VISIT_QUERY}#alert-signup` : "/alerts#alert-signup"} hint="Leave these empty to get the week's newest vacancies. The weekly email follows one search; you can change it later." />}
              />
            </div>
          </section>
          <div className="space-y-6">
            <AlertExample heading="What the weekly email looks like" kind="weekly" />
          </div>
        </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Email job alerts"
        crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: "Job alerts" }]}
        intro={`Many international vacancies are open for only a few weeks. Alerts (launching soon) send new matches for the roles, organizations and places you choose. ${p.trialDays}-day free trial, then ${p.priceSummary}.`}
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="max-w-xl">
          <div id="alert-signup" className="scroll-mt-24">
            <PremiumInterestForm source="alerts-page" search={search ?? undefined} watch={<WatchFields search={search} searchLabel={searchLabel} resetHref="/alerts#alert-signup" />} />
          </div>
        </div>
        <div className="rounded-2xl border border-rule bg-candy-soft p-6">
          <h2 className="text-xl font-semibold text-ink">What you&apos;ll get</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate">
            {p.features.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <p className="mt-5 text-slate">
            Browsing and searching every vacancy stays free. <Link href="/pricing" className="font-medium text-accent hover:underline">See prices and questions</Link>.
          </p>
          <div className="mt-8">
            <AlertExample />
          </div>
        </div>
      </div>
    </>
  );
}
