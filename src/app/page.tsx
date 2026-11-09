import Link from "next/link";
import { AlertSignup } from "@/components/alert-signup";
import { JobGrid, OrgBadge } from "@/components/job-card";
import { Flag } from "@/components/flag";
import { HeroSearch } from "@/components/search-forms";
import { TrackedLink } from "@/components/tracking";
import { BILLING_LIVE } from "@/lib/billing/live";
import { closingSoonJobs, categoryFacets, countryFacets, experienceFacets, gradeFacets, jobTypeFacets, languageFacets, latestJobs, organizationFacets, orgTypeFacets, regionFacets, siteStats } from "@/lib/jobs";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { absoluteUrl, jsonLd, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [latest, orgs, countries, categories, stats, types, regions, grades, langs, exps, orgTypes, closing] = await Promise.all([
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
  ]);
  const closingFresh = closing.filter((j) => !latest.some((l) => l.id === j.id));
  // The grid has two columns on wide screens: show 4 or 2 so no row is half empty, none below 2.
  const closingSoon = closingFresh.slice(0, closingFresh.length >= 4 ? 4 : closingFresh.length >= 2 ? 2 : 0);

  const showTotal = stats.active >= siteConfig.showVacancyCountFrom;
  // Entry points by employer type (the row under the hero search): every type, with its count when it has open jobs.
  const employerTypes = EMPLOYER_TYPE_PAGES.map((t) => ({ ...t, count: orgTypes.find((o) => o.value === t.orgtype)?.count ?? 0 }));

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

      {/* Hero */}
      <section className="bg-candy-hero relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/world-dots.svg" alt="" aria-hidden="true" className="world-dots hero-dots" />
        <div className="relative mx-auto max-w-6xl px-4 pb-5 pt-5 sm:px-6 sm:pb-12 sm:pt-16">
          <div className="max-w-3xl">
            <h1 className="max-w-[20ch] text-[1.7rem] font-semibold leading-[1.1] text-white sm:text-[3.5rem]">{siteConfig.home.headline}</h1>
            <p className="mt-5 hidden max-w-2xl text-lg leading-relaxed text-white/85 sm:block">
              {siteConfig.home.subheadline}
            </p>
          </div>
          <div className="mt-4 max-w-4xl sm:mt-9">
            <HeroSearch facets={{ orgs, countries, regions, categories, types, grades, langs, exps, orgTypes }} />
          </div>
          <nav aria-label="Employer types" className="mt-4 max-w-4xl">
            <ul className="flex flex-wrap gap-2">
              {employerTypes.map((t) => (
                <li key={t.path}>
                  <Link
                    href={t.path}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-1 text-sm font-medium text-white hover:border-white hover:bg-white/10"
                  >
                    {t.label}
                    {t.count > 0 ? <span className="font-normal text-white/75">{t.count.toLocaleString("en-US")}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="mt-5 hidden flex-wrap gap-x-5 gap-y-2 text-[0.95rem] text-white/85 sm:flex">
            <span className="text-white">
              {showTotal ? (
                <>
                  <strong className="font-semibold">{stats.active.toLocaleString("en-US")}</strong> open vacancies
                  {stats.orgs ? <> from <strong className="font-semibold">{stats.orgs}</strong> organizations</> : null}
                </>
              ) : (
                <>New vacancies added every few hours</>
              )}
            </span>
            <Link href="/alerts" className="font-semibold text-highlight underline decoration-highlight/50 underline-offset-4 hover:decoration-highlight">Get new ones by email</Link>
          </p>
          <p className="mt-3 text-xs text-white/75 sm:text-sm">{siteConfig.name} is independent and not affiliated with the United Nations, the EU or any employer listed.</p>
        </div>
      </section>

      {/* Latest */}
      <div className="dots-soft border-b border-rule pb-14">
      <section className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12" aria-labelledby="latest-heading">
        <div className="flex items-end justify-between gap-4">
          <h2 id="latest-heading" className="text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">Recently posted, UN system first</h2>
          <Link href="/jobs" className="hidden shrink-0 text-[0.95rem] font-medium text-accent hover:underline sm:inline">{showTotal ? `See all ${stats.active.toLocaleString("en-US")} jobs` : "See all jobs"}</Link>
        </div>
        <div className="mt-5">
          {latest.length ? (
            <>
              <JobGrid jobs={latest} mobileLimit={5} />
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
          <div className="mt-5"><JobGrid jobs={closingSoon} /></div>
        </section>
      ) : null}
      {countries.length ? (
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6" aria-label="Browse by duty station">
          <div className="space-y-3">
            {countries.length ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <span className="shrink-0 text-sm font-medium text-slate sm:w-28 sm:pt-1.5">Duty stations</span>
                <div className="flex flex-wrap items-center gap-2">
                  {countries.slice(0, 8).map((c) => (
                    <Link
                      key={c.slug}
                      href={`/locations/${c.slug}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
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
          <ul className="flex flex-wrap gap-x-2 gap-y-1.5 text-[0.95rem] text-ink">
            {["Updated every 2 hours", "Apply links go to the employer", "Local-only posts flagged", "No sign-in needed"].map((f, i) => (
              <li key={f} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden="true" className="text-slate">·</span> : null}
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

      {/* Browse */}
      <section className="mx-auto mt-14 grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2" aria-label="Browse">
        <div>
          <div className="flex items-end justify-between">
            <h2 className="text-[1.6rem] font-semibold leading-tight text-ink">Browse by organization</h2>
            <Link href="/organizations" className="text-[0.95rem] font-medium text-accent hover:underline">All organizations</Link>
          </div>
          <ul className="mt-5 divide-y divide-rule border-y border-rule">
            {orgs.slice(0, 8).map((o) => (
              <li key={o.slug}>
                <Link href={`/organizations/${o.slug}`} className="flex items-center gap-3 py-3 hover:bg-mist">
                  <OrgBadge name={o.name} short={o.short_name} />
                  <span className="flex-1 text-ink">{o.name}</span>
                  <span className="pr-2 text-sm tabular-nums text-slate">{o.count} {o.count === 1 ? "job" : "jobs"}</span>
                </Link>
              </li>
            ))}
            {orgs.length === 0 ? <li className="py-3 text-slate">Organizations appear here after the first import.</li> : null}
          </ul>
        </div>
        <div>
          <div className="flex items-end justify-between">
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

      {/* Alerts */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="alerts-heading">
        <div className="bg-candy-band relative grid items-center gap-8 overflow-hidden rounded-2xl px-6 py-10 text-white sm:px-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h2 id="alerts-heading" className="text-[1.9rem] font-semibold leading-tight">Let {siteConfig.name} bring new vacancies to you</h2>
            <p className="mt-3 max-w-lg leading-relaxed text-white/80">
              {siteConfig.freeWeeklyEmail
                ? "A free Monday email with the past week's new vacancies for the search you choose. No card, no account, unsubscribe with one click."
                : "New vacancies for the roles, organizations and places you choose, by email, with the closing date whenever the employer publishes one."}
            </p>
          </div>
          {siteConfig.freeWeeklyEmail ? (
            <div>
              <Link href="/alerts" className="block rounded-lg bg-highlight px-5 py-3 text-center text-base font-semibold text-ink hover:brightness-95 sm:inline-block">
                Get the free weekly email
              </Link>
              <p className="mt-4 text-sm leading-relaxed text-white/80">
                Want new matches every day, with up to 5 searches?{" "}
                <TrackedLink href="/pricing/trial" event="premium_cta_click" source="home-daily" className="font-semibold text-white underline underline-offset-4">
                  {BILLING_LIVE ? `Daily alerts: ${siteConfig.premium.trialDays}-day free trial` : "Daily alerts are coming: get early access"}
                </TrackedLink>
              </p>
            </div>
          ) : (
            <AlertSignup source="home" tone="dark" />
          )}
        </div>
      </section>
    </>
  );
}
