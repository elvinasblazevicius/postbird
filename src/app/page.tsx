import type { Metadata } from "next";
import Link from "next/link";
import { AlertSignup } from "@/components/alert-signup";
import { AlertsChoice } from "@/components/alerts-choice";
import { JobList } from "@/components/job-card";
import { Flag } from "@/components/flag";
import { HeroFlags } from "@/components/hero-flags";
import { HeroSearch } from "@/components/search-forms";
import { WEEK_IN_REVIEW_MIN, WeekInReviewStrip } from "@/components/week-in-review";
import { jobsUrl, type WeekInReview } from "@/lib/jobs";
import { closingSoonJobs, categoryFacets, countryFacets, experienceFacets, gradeFacets, jobTypeFacets, languageFacets, latestJobs, organizationFacets, orgTypeFacets, regionFacets, siteStats, weekInReview } from "@/lib/jobs";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { euListingsOpen, homeCopy } from "@/lib/eu-claim";
import { shareMetadata } from "@/lib/share-metadata";
import { absoluteUrl, formatShortDate, jsonLd, siteConfig } from "@/lib/site";
import { BILLING_LIVE } from "@/lib/billing/live";

export const dynamic = "force-dynamic";

/** The title and description name the EU only while EU institutions have open vacancies here (see src/lib/eu-claim.ts). */
export async function generateMetadata(): Promise<Metadata> {
  const { tagline, description } = homeCopy(await euListingsOpen());
  const title = `${siteConfig.name} — ${tagline}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    ...shareMetadata(title, description),
  };
}

/**
 * Phones only: the week's count and the busiest duty stations in one compact module (on wider
 * screens they are the full "This week in international jobs" strip and the duty-station row).
 * The count shows only from WEEK_IN_REVIEW_MIN new vacancies, like the strip.
 */
function PhoneWeekAndPlaces({ week, countries }: { week: WeekInReview; countries: { slug: string; code: string; name: string; count: number }[] }) {
  const showWeek = week.total >= WEEK_IN_REVIEW_MIN;
  if (!showWeek && !countries.length) return null;
  return (
    <section className="mx-4 mt-8 rounded-xl border border-rule bg-paper p-4 sm:hidden" aria-labelledby="week-phone-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="week-phone-heading" className="text-[1.2rem] font-semibold leading-tight text-ink">{showWeek ? "This week" : "Duty stations"}</h2>
          {showWeek ? (
            <Link href={jobsUrl({ posted: "7" })} className="group mt-2 block text-ink">
              <span className="font-display text-[1.75rem] font-semibold leading-none group-hover:text-accent">{week.total.toLocaleString("en-US")}</span>{" "}
              <span className="text-[0.95rem] text-slate group-hover:underline">new vacancies in the past 7 days</span>
            </Link>
          ) : null}
        </div>
        {showWeek ? <span className="shrink-0 rounded-full bg-tint px-2.5 py-1 text-[0.8125rem] font-semibold text-tint-ink">Week to {formatShortDate(new Date())}</span> : null}
      </div>
      {countries.length ? (
        <div className={showWeek ? "mt-4 border-t border-rule pt-3" : "mt-3"}>
          {showWeek ? <h3 className="font-sans text-sm font-medium text-slate">Busiest duty stations</h3> : null}
          <ul className="mt-2 flex flex-wrap gap-2">
            {countries.slice(0, 4).map((c) => (
              <li key={c.slug}>
                <Link href={`/locations/${c.slug}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rule px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent">
                  <Flag code={c.code} className="shadow-[0_0_0_1px_rgba(14,27,44,0.15)]" />
                  {c.name}
                  <span className="font-normal text-slate">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/locations" className="mt-2 inline-block py-1 text-sm font-medium text-accent underline underline-offset-4">All locations</Link>
        </div>
      ) : null}
    </section>
  );
}

/** What is true of every listing (see the comment above the facts strip below). */
const FACTS = ["Updated every 2 hours", "Apply links go to the employer", "Local-only posts flagged", "No sign-in needed"];

export default async function HomePage() {
  const [latest, orgs, countries, categories, stats, types, regions, grades, langs, exps, orgTypes, closing, week] = await Promise.all([
    latestJobs(8),
    organizationFacets(),
    countryFacets(),
    categoryFacets(),
    siteStats(),
    jobTypeFacets(),
    regionFacets(),
    gradeFacets(),
    languageFacets(),
    experienceFacets(),
    orgTypeFacets(),
    closingSoonJobs(12),
    // The strip is optional: if its query fails, the page shows without it.
    weekInReview().catch(() => ({ total: 0, types: [], orgs: [] })),
  ]);
  const closingFresh = closing.filter((j) => !latest.some((l) => l.id === j.id));
  // The grid has two columns on wide screens: show 4 or 2 so no row is half empty, none below 2.
  const closingSoon = closingFresh.slice(0, closingFresh.length >= 4 ? 4 : closingFresh.length >= 2 ? 2 : 0);

  const showTotal = stats.active >= siteConfig.showVacancyCountFrom;
  // Entry points by employer type (the row under the hero search): the types with open jobs, with their counts
  // (a type with none stays reachable from /organizations).
  const employerTypes = EMPLOYER_TYPE_PAGES.map((t) => ({ ...t, count: orgTypes.find((o) => o.value === t.orgtype)?.count ?? 0 })).filter((t) => t.count > 0);
  // The headline names the EU only while EU institutions have open vacancies here.
  const copy = homeCopy((orgTypes.find((o) => o.value === "eu")?.count ?? 0) > 0);

  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: absoluteUrl("/"),
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl("/jobs")}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(websiteLd) }} />

      {/* Hero: a light sky field, the search in a white card, and the flags of the places these employers post. */}
      <section className="border-b border-sky-rule bg-sky-wash">
        <div className="hero-row mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-7 pt-6 sm:px-6 sm:pb-12 sm:pt-14 lg:flex-row lg:items-center lg:gap-12">
          <div className="min-w-0 lg:flex-[1.35]">
            <h1 className="max-w-[20ch] text-[1.9rem] font-bold leading-[1.06] text-ink sm:text-[3.25rem]">{copy.headline}</h1>
            <p className="mt-4 hidden max-w-2xl text-lg leading-relaxed text-tint-ink sm:block">
              {copy.subheadline}
            </p>
            <div className="mt-5 rounded-2xl bg-paper p-3 shadow-[0_10px_30px_rgba(11,99,206,0.14)] sm:mt-7 sm:p-4">
              <HeroSearch facets={{ orgs, countries, regions, categories, types, grades, langs, exps, orgTypes }} />
            </div>
            {/* The one thing only the paid plan does, said once under the search. */}
            <p className="mt-4 flex items-start gap-2 text-[0.95rem] leading-relaxed text-ink">
              <svg viewBox="0 0 20 20" className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 text-brand" aria-hidden="true">
                <circle cx="10" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 7v3.7l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>
                <strong className="font-semibold">Closing-date reminders:</strong> daily alerts email you the vacancies you&apos;d want that close in the next 3 days.{" "}
                <Link href="/pricing" className="font-medium text-accent underline underline-offset-2">{BILLING_LIVE ? `Try ${siteConfig.premium.trialDays} days free` : "See how"}</Link>
              </span>
            </p>
            {/* Said once, where a first-time visitor decides whether to trust the site. */}
            <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-tint-ink">
              <svg viewBox="0 0 20 20" className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 text-brand" aria-hidden="true">
                <path d="M10 2.5 4 5v4.5c0 3.6 2.4 6.6 6 8 3.6-1.4 6-4.4 6-8V5l-6-2.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="m7.4 10 1.9 1.9 3.4-3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Independent site, not affiliated with the UN or any employer. Every Apply or Careers site button opens the employer&apos;s own website or application system.</span>
            </p>
            {employerTypes.length ? <nav aria-label="Employer types" className="mt-4">
              <ul className="flex flex-wrap gap-2">
                {employerTypes.map((t) => (
                  <li key={t.path}>
                    <Link
                      href={t.path}
                      className="inline-flex items-center gap-1.5 rounded-full border border-sky-rule bg-paper px-3.5 py-1.5 text-sm font-semibold text-ink hover:border-brand hover:text-accent max-sm:min-h-11"
                    >
                      {t.label}
                      <span className="text-[0.8125rem] font-medium tabular-nums text-slate">{t.count.toLocaleString("en-US")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav> : null}
            <p className="mt-4 hidden flex-wrap gap-x-5 gap-y-2 text-[0.95rem] text-tint-ink sm:flex">
              <span>
                {showTotal ? (
                  <>
                    <strong className="font-semibold text-ink">{stats.active.toLocaleString("en-US")}</strong> open vacancies
                    {stats.orgs ? <> from <strong className="font-semibold text-ink">{stats.orgs}</strong> organizations</> : null}
                  </>
                ) : stats.orgs ? (
                  // "Updated every 2 hours" is said once on this page, in the facts strip below.
                  <>Vacancies from <strong className="font-semibold text-ink">{stats.orgs}</strong> organizations</>
                ) : null}
              </span>
            </p>
          </div>
          <HeroFlags className="hero-flags lg:flex-1" />
        </div>
      </section>

      {/* Latest */}
      <div className="dots-soft border-b border-rule pb-14">
      <section className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12" aria-labelledby="latest-heading">
        <div className="flex items-end justify-between gap-4">
          <h2 id="latest-heading" className="text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">Recently posted</h2>
          <Link href="/jobs" className="hidden shrink-0 text-[0.95rem] font-medium text-accent hover:underline sm:inline">{showTotal ? `See all ${stats.active.toLocaleString("en-US")} jobs` : "See all jobs"}</Link>
        </div>
        <div className="mt-5">
          {latest.length ? (
            <>
              {/* One column, like /jobs: titles keep the row's width and the date chips line up. */}
              <JobList jobs={latest} mobileLimit={5} />
              <Link href="/jobs" className="mt-4 block rounded-lg border border-rule bg-paper px-4 py-3 text-center font-medium text-accent hover:bg-mist sm:hidden">
                {showTotal ? `See all ${stats.active.toLocaleString("en-US")} jobs` : "See all jobs"}
              </Link>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-rule p-8 text-slate">
              No vacancies have been imported yet. Once the first feed sync runs, the newest openings appear here.
            </div>
          )}
        </div>
      </section>
      {closingSoon.length ? (
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6" aria-labelledby="closing-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 id="closing-heading" className="text-[1.6rem] font-semibold leading-tight text-ink">Closing soon</h2>
              <p className="mt-1 text-[0.95rem] text-slate">Published closing dates in the next two weeks.</p>
            </div>
            <Link href="/jobs?sort=deadline" className="shrink-0 text-[0.95rem] font-medium text-accent hover:underline">All by closing date</Link>
          </div>
          <div className="mt-5"><JobList jobs={closingSoon} /></div>
        </section>
      ) : null}
      {/* The week's numbers after the vacancies themselves. Phones get one compact module with the duty stations instead. */}
      <WeekInReviewStrip week={week} className="hidden sm:block sm:pt-12" />
      <PhoneWeekAndPlaces week={week} countries={countries} />
      {countries.length ? (
        <section className="mx-auto hidden max-w-6xl px-4 pt-12 sm:block sm:px-6" aria-label="Browse by duty station">
          <div className="space-y-3">
            {countries.length ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <span className="shrink-0 text-sm font-medium text-slate sm:w-28 sm:pt-1.5">Duty stations</span>
                <div className="flex flex-wrap items-center gap-2">
                  {countries.slice(0, 8).map((c) => (
                    <Link
                      key={c.slug}
                      href={`/locations/${c.slug}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent max-sm:min-h-11"
                    >
                      <Flag code={c.code} className="shadow-[0_0_0_1px_rgba(14,27,44,0.15)]" />
                      {c.name}
                      <span className="font-normal text-slate">{c.count}</span>
                    </Link>
                  ))}
                  <Link href="/locations" className="px-1 text-sm font-medium text-accent underline underline-offset-4">All locations</Link>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      </div>

      {/* What is true of every listing: facts, not claims. Checked against the code: imports run every 2 hours
          (.github/workflows/scheduled.yml), listings without an employer link aren't shown (src/lib/feeds), local-only
          posts carry a tag (isLocalOnly in src/lib/grades.ts) and nothing on the site needs an account. */}
      <section className="mx-auto mt-12 max-w-6xl px-4 sm:px-6" aria-labelledby="facts-heading">
        <h2 id="facts-heading" className="sr-only">About the listings</h2>
        <div className="flex flex-col gap-3 border-y border-rule py-4 sm:flex-row sm:items-center sm:justify-between">
          {/* No text separators: the gap and a small mark before each fact, so a wrapped line never ends or starts with a lone "·". */}
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.95rem] text-ink">
            {FACTS.map((f) => (
              <li key={f} className="flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                {f}
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
            <Link href="/guides/how-to-read-a-un-vacancy" className="text-accent hover:underline">How to read a UN vacancy</Link>
            <Link href="/about" className="text-accent hover:underline">How it works</Link>
          </div>
        </div>
      </section>

      {/* Browse. Phones: two links instead of the two long lists. */}
      <nav aria-label="Browse organizations and categories" className="mx-auto mt-10 grid max-w-6xl grid-cols-2 gap-3 px-4 sm:hidden">
        {[
          { href: "/organizations", label: "Browse by organization", count: orgs.length },
          { href: "/categories", label: "Browse by category", count: categories.filter((c) => c.count > 0).length },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="flex flex-col justify-between gap-2 rounded-xl border border-rule bg-paper px-4 py-3.5 font-semibold leading-snug text-ink hover:border-accent hover:text-accent">
            {l.label}
            {l.count ? <span className="text-sm font-normal text-slate">{l.count.toLocaleString("en-US")} with open jobs</span> : null}
          </Link>
        ))}
      </nav>
      <section className="mx-auto mt-14 hidden max-w-6xl gap-12 px-4 sm:grid sm:px-6 lg:grid-cols-2" aria-label="Browse">
        <div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <h2 className="text-[1.6rem] font-semibold leading-tight text-ink">Browse by organization</h2>
            <Link href="/organizations" className="text-[0.95rem] font-medium text-accent hover:underline">All organizations</Link>
          </div>
          <ul className="mt-5 divide-y divide-rule border-y border-rule">
            {orgs.slice(0, 8).map((o) => (
              <li key={o.slug}>
                <Link href={`/organizations/${o.slug}`} className="flex items-center gap-3 py-3 hover:bg-mist">
                  <span className="flex-1 text-ink">{o.name}</span>
                  <span className="pr-2 text-sm tabular-nums text-slate">{o.count} {o.count === 1 ? "job" : "jobs"}</span>
                </Link>
              </li>
            ))}
            {orgs.length === 0 ? <li className="py-3 text-slate">Organizations appear here after the first import.</li> : null}
          </ul>
        </div>
        <div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <h2 className="text-[1.6rem] font-semibold leading-tight text-ink">Browse by career category</h2>
            <Link href="/categories" className="text-[0.95rem] font-medium text-accent hover:underline">All categories</Link>
          </div>
          <ul className="mt-5 grid grid-cols-1 gap-x-6 border-t border-rule sm:grid-cols-2">
            {categories.filter((c) => c.count > 0).map((c) => (
              <li key={c.slug} className="border-b border-rule">
                <Link href={`/categories/${c.slug}`} className="flex items-baseline justify-between gap-3 py-3 hover:text-accent">
                  <span className="text-ink">{c.name}</span>
                  <span className="text-sm tabular-nums text-slate">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Alerts: one choice, weekly (free) or daily (trial) */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="alerts-heading">
        <div className="bg-candy-band grid items-center gap-6 rounded-2xl px-5 py-8 text-white sm:px-8 lg:grid-cols-[1fr_1.25fr] lg:gap-8">
          <div>
            <h2 id="alerts-heading" className="text-[1.65rem] font-bold leading-tight text-white">Get new jobs by email</h2>
            <p className="mt-2 max-w-md leading-relaxed text-[#e3f1ff]">
              Pick a search once. We send you the new vacancies that match it, so you stop checking twenty careers sites.
            </p>
          </div>
          {siteConfig.freeWeeklyEmail ? (
            <AlertsChoice weeklyHref="/alerts#alert-signup" trialHref="/pricing/trial" source="home-daily" onBand />
          ) : (
            <AlertSignup source="home" tone="dark" />
          )}
        </div>
      </section>
    </>
  );
}
