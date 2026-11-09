import Link from "next/link";
import { AlertSignup } from "@/components/alert-signup";
import { JobGrid, OrgBadge } from "@/components/job-card";
import { Flag } from "@/components/flag";
import { HeroSearch } from "@/components/search-forms";
import { closingSoonJobs, categoryFacets, countryFacets, experienceFacets, gradeFacets, jobTypeFacets, languageFacets, latestJobs, organizationFacets, orgTypeFacets, regionFacets, siteStats } from "@/lib/jobs";
import { absoluteUrl, jsonLd, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [latest, orgs, countries, categories, stats, types, regions, grades, langs, exps, orgTypes, closing] = await Promise.all([
    latestJobs(9),
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
    closingSoonJobs(6),
  ]);
  const closingSoon = closing.filter((j) => !latest.some((l) => l.id === j.id)).slice(0, 3);

  const showTotal = stats.active >= siteConfig.showVacancyCountFrom;

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
      <section className="bg-candy-hero grain relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flag-wall.svg" alt="" aria-hidden="true" className="flag-wall" />
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
          <h2 id="latest-heading" className="text-[1.9rem] font-semibold text-ink">Latest vacancies</h2>
          <Link href="/jobs" className="shrink-0 text-[0.95rem] font-medium text-accent hover:underline">{showTotal ? `See all ${stats.active.toLocaleString("en-US")} jobs` : "See all jobs"}</Link>
        </div>
        <div className="mt-6">
          {latest.length ? (
            <JobGrid jobs={latest} />
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
              <h2 id="closing-heading" className="text-[1.6rem] font-semibold text-ink">Closing soon</h2>
              <p className="mt-1 text-[0.95rem] text-slate">Published closing dates in the next two weeks.</p>
            </div>
            <Link href="/jobs?sort=deadline" className="shrink-0 text-[0.95rem] font-medium text-accent hover:underline">All by closing date</Link>
          </div>
          <div className="mt-6"><JobGrid jobs={closingSoon} /></div>
        </section>
      ) : null}
      {orgs.length || countries.length ? (
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6" aria-label="Hiring now">
              <div className="space-y-3">
                {orgs.length ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                    <span className="shrink-0 text-sm font-medium text-slate sm:w-28 sm:pt-1.5">Hiring now</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {orgs.slice(0, 10).map((o) => (
                        <Link
                          key={o.slug}
                          href={`/organizations/${o.slug}`}
                          className="rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-semibold tracking-wide text-ink hover:border-accent hover:text-accent"
                        >
                          {o.short_name && o.short_name.length <= 12 ? o.short_name : o.name}
                          <span className="ml-1.5 font-normal text-slate">{o.count}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
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

      {/* Browse */}
      <section className="mx-auto mt-16 grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2" aria-label="Browse">
        <div>
          <div className="flex items-end justify-between">
            <h2 className="text-[1.6rem] font-semibold text-ink">Browse by organization</h2>
            <Link href="/organizations" className="text-[0.95rem] font-medium text-accent hover:underline">All organizations</Link>
          </div>
          <ul className="mt-5 divide-y divide-rule border-y border-rule">
            {orgs.slice(0, 8).map((o) => (
              <li key={o.slug}>
                <Link href={`/organizations/${o.slug}`} className="flex items-center gap-3 py-3 hover:bg-mist">
                  <OrgBadge name={o.name} short={o.short_name} logo={o.logo} />
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
            <h2 className="text-[1.6rem] font-semibold text-ink">Browse by career category</h2>
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

      {/* How it works */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-[1.6rem] font-semibold text-ink">How {siteConfig.name} works</h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            ["We gather vacancies", "Openings published by UN agencies and international organizations are collected from their public job feeds several times a day."],
            ["You search one place", "Every listing is organized by organization, country, category and deadline. Closed vacancies are removed automatically."],
            ["You apply on the employer's site", "Each listing links to the employer's own website. We never take applications or ask for fees."],
          ].map(([title, body], i) => (
            <li key={title} className="dots-soft rounded-2xl border border-rule p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand font-display text-2xl font-semibold text-white">{i + 1}</span>
              <h3 className="mt-3 text-xl font-semibold text-ink">{title}</h3>
              <p className="mt-2 leading-relaxed text-slate">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-slate">
          Details we can&apos;t confirm from the source are shown as &quot;Not specified&quot;. <Link href="/about" className="text-accent hover:underline">More about our sources</Link>
        </p>
      </section>

      {/* Alerts */}
      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6" aria-labelledby="alerts-heading">
        <div className="bg-candy-band grain relative grid items-center gap-8 overflow-hidden rounded-2xl px-6 py-10 text-white sm:px-10 lg:grid-cols-[1.1fr_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/world-dots.svg" alt="" aria-hidden="true" className="world-dots -left-40 -top-24 w-[900px] opacity-[0.10]" />
          <div>
            <h2 id="alerts-heading" className="text-[1.9rem] font-semibold leading-tight">Let {siteConfig.name} bring new vacancies to you</h2>
            <p className="mt-3 max-w-lg leading-relaxed text-white/80">
              {siteConfig.freeWeeklyEmail
                ? "A short Monday email with the week's newest openings. Free, no account needed, unsubscribe with one click."
                : "Email alerts for the roles, organizations and places you choose, with reminders before deadlines."}
            </p>
          </div>
          <AlertSignup source="home" tone="dark" />
        </div>
      </section>
    </>
  );
}
