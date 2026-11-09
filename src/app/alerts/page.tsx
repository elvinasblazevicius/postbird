import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertExample } from "@/components/alert-example";
import { WatchFields } from "@/components/alert-watch-step";
import { PageHeader } from "@/components/page-header";
import { FreeWeeklyForm, PremiumInterestForm } from "@/components/token-forms";
import { TrackedLink } from "@/components/tracking";
import { EARLY_ACCESS_BUTTON, earlyAccessLine } from "@/lib/early-access-copy";
import { BILLING_LIVE } from "@/lib/billing/live";
import { describeSearch, searchFromAlertStep } from "@/lib/saved-searches";
import { siteConfig } from "@/lib/site";

const free = siteConfig.freeWeeklyEmail;

export const metadata: Metadata = {
  title: free
    ? "Free weekly job email for UN and international organization vacancies"
    : "Email job alerts for UN and international organization vacancies",
  description: free
    ? "A free Monday email with the past week's new vacancies at UN agencies and international organizations that match your search. No card, no account, one-click unsubscribe."
    : "New UN and international organization vacancies by email, filtered by role, organization and location, with the closing date whenever the employer publishes one.",
  alternates: { canonical: "/alerts" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 shrink-0 text-remote" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

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
  const searchLabel = search ? await describeSearch(search) : null;
  if (free) {
    const trialHref = `/pricing/trial${search ? `?search=${encodeURIComponent(search)}` : ""}`;
    return (
      <>
        <PageHeader
          title="Free weekly job email"
          crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: "Weekly email" }]}
          intro="Every Monday, the past week's new vacancies that match your search, each linked to the employer's own website. Free, with no card and no account. If nothing new matches, we don't send anything that week."
        />
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
          <section className="max-w-xl" aria-labelledby="free-h">
            <h2 id="free-h" className="sr-only">Sign up for the free weekly email</h2>
            <div id="alert-signup" className="scroll-mt-24">
              <FreeWeeklyForm
                source={search ? "search-weekly" : "alerts-page"}
                search={search ?? undefined}
                watch={<WatchFields search={search} searchLabel={searchLabel} hint="Leave these empty to get the week's newest vacancies. The weekly email follows one search; you can change it later." />}
              />
            </div>
          </section>
          <div className="space-y-10">
            <section className="rounded-2xl border border-rule bg-candy-soft p-6" aria-labelledby="daily-h">
              <h2 id="daily-h" className="text-xl font-semibold text-ink">Want new matches every day?</h2>
              <p className="mt-2 text-slate">
                Daily alerts are the paid plan: {p.priceSummary}{BILLING_LIVE ? `, with a ${p.trialDays}-day free trial` : ", launching soon"}.
              </p>
              <ul className="mt-4 space-y-2.5 text-ink">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5"><Check />{f}</li>
                ))}
              </ul>
              <TrackedLink
                href={trialHref}
                event="premium_cta_click"
                source={search ? "alerts-daily-search" : "alerts-daily"}
                className="mt-6 block rounded-lg border-2 border-brand bg-paper px-5 py-3 text-center font-semibold text-brand hover:bg-mist"
              >
                {BILLING_LIVE ? `Start ${p.trialDays}-day free trial` : EARLY_ACCESS_BUTTON}
              </TrackedLink>
              <p className="mt-3 text-sm text-slate">
                {BILLING_LIVE ? "Card required to start the trial. Cancel before it ends and you pay nothing. " : `${earlyAccessLine()} `}
                <Link href="/pricing" className="font-medium text-accent hover:underline">Compare free and paid</Link>
              </p>
            </section>
            <AlertExample heading="What the email looks like" />
          </div>
        </div>
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
            <PremiumInterestForm source="alerts-page" search={search ?? undefined} watch={<WatchFields search={search} searchLabel={searchLabel} />} />
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
