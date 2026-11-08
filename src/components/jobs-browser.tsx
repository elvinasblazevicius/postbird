import Link from "next/link";
import { activeFilterCount, categoryFacets, countryFacets, experienceFacets, gradeFacets, jobsUrl, jobTypeFacets, languageFacets, organizationFacets, orgTypeFacets, regionFacets, searchJobs, type JobFilters } from "@/lib/jobs";
import siteConfig from "@site-config";
import { AlertSignup } from "./alert-signup";
import { JobList } from "./job-card";
import { FilterForm } from "./search-forms";
import { TrackedLink } from "./tracking";
import { TrackOnMount } from "./tracking";

function Pagination({ page, pages, filters, base }: { page: number; pages: number; filters: JobFilters; base: string }) {
  if (pages <= 1) return null;
  const nums = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const list = [...nums].sort((a, b) => a - b);
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center gap-1.5">
      {page > 1 ? (
        <Link rel="prev" href={jobsUrl({ ...filters, page: page - 1 }, base)} className="rounded-lg border border-rule px-3 py-2 text-sm text-ink hover:bg-mist">Previous</Link>
      ) : null}
      {list.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {i > 0 && n - list[i - 1] > 1 ? <span className="px-1 text-slate">…</span> : null}
          <Link
            href={jobsUrl({ ...filters, page: n }, base)}
            aria-current={n === page ? "page" : undefined}
            className={`min-w-10 rounded-lg px-3 py-2 text-center text-sm ${n === page ? "bg-brand font-semibold text-white" : "border border-rule text-ink hover:bg-mist"}`}
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pages ? (
        <Link rel="next" href={jobsUrl({ ...filters, page: page + 1 }, base)} className="rounded-lg border border-rule px-3 py-2 text-sm text-ink hover:bg-mist">Next</Link>
      ) : null}
    </nav>
  );
}

/**
 * Search results with filters. `fixed` filters belong to a landing page
 * (e.g. one organization) and are not shown as editable fields.
 */
export async function JobsBrowser({
  filters,
  fixed = {},
  base = "/jobs",
  emptyHint,
}: {
  filters: JobFilters;
  fixed?: Partial<JobFilters>;
  base?: string;
  emptyHint?: React.ReactNode;
}) {
  const effective = { ...filters, ...fixed };
  const [result, orgs, countries, regions, categories, types, grades, langs, exps, orgTypes] = await Promise.all([
    searchJobs(effective),
    organizationFacets(),
    countryFacets(),
    regionFacets(),
    categoryFacets(),
    jobTypeFacets(),
    gradeFacets(),
    languageFacets(),
    experienceFacets(),
    orgTypeFacets(),
  ]);
  const facets = { orgs, countries, regions, categories, types, grades, langs, exps, orgTypes };
  const hidden: Record<string, string> = {};
  if (fixed.org) hidden.org = fixed.org;
  if (fixed.country) hidden.country = fixed.country;
  if (fixed.region) hidden.region = fixed.region;
  if (fixed.category) hidden.category = fixed.category;
  if (fixed.remote) hidden.remote = "1";
  // On landing pages the fixed filter is in the path, so don't repeat it in the form.
  const formHidden = base === "/jobs" ? {} : Object.fromEntries(Object.keys(hidden).map((k) => [k, ""]));
  const userFilters = activeFilterCount(filters);
  const from = (result.page - 1) * result.pageSize + 1;
  const to = from + result.items.length - 1;

  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
      <aside>
        <details className="group rounded-xl border border-rule p-4 lg:hidden" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink [&::-webkit-details-marker]:hidden">
            Filters{userFilters ? ` (${userFilters})` : ""}
            <span className="text-sm text-accent group-open:hidden">Show</span>
            <span className="hidden text-sm text-accent group-open:inline">Hide</span>
          </summary>
          <div className="mt-4">
            <FilterForm formId="filters-mobile" filters={filters} facets={facets} action={base} hidden={formHidden} />
          </div>
        </details>
        <div className="sticky top-24 hidden lg:block">
          <FilterForm formId="filters-desktop" filters={filters} facets={facets} action={base} hidden={formHidden} />
        </div>
      </aside>

      <section aria-labelledby="results-heading">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="results-heading" className="font-sans text-base font-medium text-slate">
            {result.total === 0
              ? "No open vacancies match"
              : result.total === 1
                ? "1 open vacancy"
                : `${from}–${to} of ${result.total.toLocaleString("en-US")} open vacancies`}
          </h2>
          <div className="flex items-center gap-1 text-sm" aria-label="Sort">
            <span className="mr-1 text-slate">Sort:</span>
            {[
              { key: "newest", label: "Newest" },
              { key: "deadline", label: "Closing soonest" },
              ...(filters.q ? [{ key: "relevance", label: "Best match" }] : []),
            ].map((o) => {
              const active = result.sort === o.key;
              return (
                <Link
                  key={o.key}
                  href={jobsUrl({ ...filters, sort: o.key as JobFilters["sort"], page: undefined }, base)}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-full px-3 py-1 ${active ? "bg-brand text-white" : "text-accent hover:bg-tint"}`}
                >
                  {o.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-candy-soft px-4 py-3">
          <p className="text-[0.95rem] text-ink">Get new jobs matching this search by email.</p>
          <TrackedLink
            href={`/pricing/trial?search=${encodeURIComponent(jobsUrl({ ...effective, page: undefined, sort: undefined }).replace(/^\/jobs\??/, ""))}`}
            event="premium_cta_click"
            source="search-alert"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11h11L12 8.5V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            Email me jobs like these
          </TrackedLink>
        </div>
        {result.items.length ? (
          <>
            <JobList jobs={result.items.slice(0, 6)} />
            {result.page === 1 ? (
              <div className="my-3 grid items-center gap-4 rounded-xl border border-rule bg-mist p-5 sm:p-6 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="font-display text-xl font-semibold text-ink">Get vacancies like these by email</p>
                  <p className="mt-1 text-sm text-slate">{siteConfig.freeWeeklyEmail ? "Free Monday email. Unsubscribe with one click." : "New matches in your inbox, so you don't have to keep checking."}</p>
                </div>
                <AlertSignup source={`list:${base}`} />
              </div>
            ) : null}
            {result.items.length > 6 ? <div className="mt-3"><JobList jobs={result.items.slice(6)} /></div> : null}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-rule p-8 text-center">
            <p className="font-display text-xl text-ink">No vacancies match these filters.</p>
            <p className="mt-2 text-slate">{emptyHint ?? "Remove a filter or try a broader keyword. New vacancies are added several times a day."}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link href={base} className="rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink hover:bg-mist">Clear filters</Link>
              <Link href="/alerts" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-accent">Get email alerts</Link>
            </div>
          </div>
        )}

        <Pagination page={result.page} pages={result.pages} filters={filters} base={base} />
        {userFilters > 0 && result.page === 1 ? (
          <TrackOnMount event={{ type: "search", props: { ...effective, results: result.total } }} />
        ) : null}
      </section>
    </div>
  );
}
