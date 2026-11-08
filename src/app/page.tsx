import Link from "next/link";
import { AlertSignup } from "@/components/alert-signup";
import { JobGrid, OrgBadge } from "@/components/job-card";
import { HeroSearch } from "@/components/search-forms";
import { categoryFacets, countryFacets, experienceFacets, gradeFacets, jobTypeFacets, languageFacets, latestJobs, organizationFacets, orgTypeFacets, regionFacets, siteStats } from "@/lib/jobs";
import { absoluteUrl, jsonLd, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [latest, orgs, countries, categories, stats, types, regions, grades, langs, exps, orgTypes] = await Promise.all([
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
  ]);

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
        <Meridians />
        <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-14 sm:px-6 sm:pt-20">
          <div className="max-w-3xl">
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] text-white sm:text-[3.6rem]">{siteConfig.home.headline}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/85">{siteConfig.home.subheadline}</p>
          </div>
          <div className="mt-9 max-w-4xl">
            <HeroSearch facets={{ orgs, countries, regions, categories, types, grades, langs, exps, orgTypes }} />
          </div>
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[0.95rem] text-white/85">
            <span className="text-white">
              <strong className="font-semibold">{stats.active.toLocaleString("en-US")}</strong> open vacancies
              {stats.orgs ? <> from <strong className="font-semibold">{stats.orgs}</strong> organizations</> : null}
            </span>
            <Link href="/alerts" className="rounded-full bg-white px-3 py-0.5 font-medium text-brand hover:bg-white/90">Get email alerts</Link>
            <Link href="/remote-jobs" className="rounded-full bg-white/15 px-3 py-0.5 text-white hover:bg-white/25">Remote and home-based</Link>
            <Link href="/jobs?closing=7&sort=deadline" className="rounded-full bg-white/15 px-3 py-0.5 text-white hover:bg-white/25">Closing this week</Link>
            <Link href="/categories/data-analytics" className="rounded-full bg-white/15 px-3 py-0.5 text-white hover:bg-white/25">Data &amp; analytics</Link>
          </p>
        </div>
      </section>

      {/* Latest */}
      <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6" aria-labelledby="latest-heading">
        <div className="flex items-end justify-between gap-4">
          <h2 id="latest-heading" className="text-[1.9rem] font-semibold text-ink">Latest vacancies</h2>
          <Link href="/jobs" className="shrink-0 text-[0.95rem] font-medium text-accent hover:underline">See all {stats.active.toLocaleString("en-US")} jobs</Link>
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
            <h2 className="text-[1.6rem] font-semibold text-ink">Browse by career category</h2>
            <Link href="/categories" className="text-[0.95rem] font-medium text-accent hover:underline">All categories</Link>
          </div>
          <ul className="mt-5 grid grid-cols-1 gap-x-6 border-t border-rule sm:grid-cols-2">
            {categories.map((c) => (
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
            ["We gather vacancies", "Openings published by UN agencies, international organizations and NGOs are collected from their public job feeds several times a day."],
            ["You search one place", "Every listing is organized by organization, country, category and deadline. Closed vacancies are removed automatically."],
            ["You apply on the official site", "Each listing links to the employer's own vacancy page. We never take applications or ask for fees."],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-rule bg-candy-soft p-6">
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
        <div className="bg-candy-band grid items-center gap-8 rounded-3xl px-6 py-10 text-white sm:px-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h2 id="alerts-heading" className="text-[1.9rem] font-semibold leading-tight">Let new vacancies come to you</h2>
            <p className="mt-3 max-w-lg leading-relaxed text-white/80">
              {siteConfig.freeWeeklyEmail
                ? "A short Monday email with the week's newest openings. Free, no account needed, unsubscribe with one click."
                : `Email alerts for the roles, organizations and places you choose, with reminders before deadlines. ${siteConfig.premium.trialDays}-day free trial, then ${siteConfig.premium.priceSummary}.`}
            </p>
          </div>
          <AlertSignup source="home" tone="dark" />
        </div>
      </section>
    </>
  );
}

/** Faint latitude/longitude lines behind the hero. Decorative only. */
function Meridians() {
  return (
    <svg aria-hidden="true" viewBox="0 0 600 600" className="pointer-events-none absolute -right-40 -top-24 hidden h-[640px] w-[640px] text-white opacity-[0.18] md:block">
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="300" cy="300" r="280" />
        {[70, 140, 210].map((rx) => (
          <ellipse key={rx} cx="300" cy="300" rx={rx} ry="280" />
        ))}
        {[-200, -110, 0, 110, 200].map((y) => {
          const half = Math.sqrt(280 * 280 - y * y);
          return <line key={y} x1={300 - half} x2={300 + half} y1={300 + y} y2={300 + y} />;
        })}
      </g>
    </svg>
  );
}
