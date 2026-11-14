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
import { isMetaVisit } from "@/lib/ad-visit";
import { describeSearch, searchFromAlertStep } from "@/lib/saved-searches";
import { countJobs, filtersFromQuery } from "@/lib/jobs";
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
    // The parts of a carried-over search the weekly card's fields don't show (kept by the sign-up), for its live "Follows:" line.
    const keptSearch = search ? new URLSearchParams(search) : null;
    for (const k of ["q", "org", "where", "country", "region"]) keptSearch?.delete(k);
    const kept = keptSearch?.size ? await describeSearch(keptSearch.toString()) : null;
    // A carried search with nothing open today: said plainly (the alert still works for what comes).
    const openNow = search ? await countJobs(filtersFromQuery(search)).catch(() => null) : null;
    const weeklyForm = (
      <FreeWeeklyForm
        compact
        source={fromMeta ? (search ? "search-weekly" : "alerts-page") : search ? "search-weekly" : "alerts-page"}
        search={search ?? undefined}
        searchLabel={searchLabel}
        kept={kept}
        keywords={<WatchFields part="keywords" search={search} searchLabel={searchLabel} />}
        watch={<WatchFields fold part="places" search={search} searchLabel={searchLabel} hint="Leave empty for every organization and place." />}
      />
    );
    return (
      <>
        <PageHeader
          title={fromMeta ? "Free weekly job email" : "Get job alerts"}
          crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: fromMeta ? "Weekly email" : "Job alerts" }]}
          intro={fromMeta
            ? "Every Monday, the week's new UN and NGO vacancies: all of them, or only those with your keywords. Free, no card, no account."
            : "New vacancies at UN agencies, NGOs and other international organizations that match your search, by email: daily with closing-date reminders, or every Monday for free."}
          // Ad visitors on phones: the form on the first screen; the same notice is in every page's footer.
          note={fromMeta ? <span className="max-sm:hidden">{INDEPENDENCE_NOTE}</span> : INDEPENDENCE_NOTE}
        />
        {fromMeta ? (
          // Visitors from Meta ads: only the free weekly email (see above), in the same card as on the plain page.
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1fr] lg:gap-12">
            <section className="max-w-xl" aria-labelledby="free-h">
              <h2 id="free-h" className="sr-only">Sign up for the free weekly email</h2>
              <div id="alert-signup" className="scroll-mt-24 rounded-[14px] border-[3px] border-sky-wash bg-sky-wash p-4 sm:p-5">{weeklyForm}</div>
              <p className="mt-3 text-sm text-slate">No email in a week with nothing new.<span className="sm:hidden"> {siteConfig.name} is independent and not affiliated with the UN or any employer listed.</span></p>
            </section>
            <div className="max-w-xl">
              <AlertExample heading="What the weekly email looks like" kind="weekly" search={search} />
            </div>
          </div>
        ) : (
          <>
            <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6" aria-labelledby="choice-h">
              <h2 id="choice-h" className="sr-only">Daily alerts or weekly email</h2>
              {searchLabel ? (
                <p data-carried-search="" className="mb-4 rounded-xl border border-sky-rule bg-sky-wash px-4 py-3 text-[0.95rem] text-ink">
                  Your alerts will follow the search you just made: <strong>{searchLabel}</strong>.{" "}
                  {openNow === 0 ? "Nothing matches it today: we email only when a new vacancy does. " : "Nothing to search again. "}
                  <Link href="/alerts" className="font-medium text-accent underline underline-offset-2">Start from scratch</Link>
                </p>
              ) : null}
              <AlertsChoice
                weeklyHref="#alert-signup"
                trialHref={trialHref}
                source={search ? "alerts-daily-search" : "alerts-daily"}
                searchLabel={searchLabel}
                weeklyForm={weeklyForm}
              />
            </section>
            {/* One sign-up per plan, in its card above: here only what the emails look like. */}
            <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
              <div className="max-w-xl">
                <AlertExample heading="What the weekly email looks like" kind="weekly" search={search} />
              </div>
            </div>
          </>
        )}
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
