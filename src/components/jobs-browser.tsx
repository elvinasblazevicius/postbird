import Link from "next/link";
import { activeFilterCount, categoryFacets, countryFacets, jobsUrl, jobTypeFacets, organizationFacets, searchJobs, type JobFilters } from "@/lib/jobs";
import { AlertSignup } from "./alert-signup";
import { JobList } from "./job-card";
import { FilterForm } from "./search-forms";
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
  const [result, orgs, countries, categories, types] = await Promise.all([
    searchJobs(effective),
    organizationFacets(),
    countryFacets(),
    categoryFacets(),
    jobTypeFacets(),
  ]);
  const hidden: Record<string, string> = {};
  if (fixed.org) hidden.org = fixed.org;
  if (fixed.country) hidden.country = fixed.country;
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
            <FilterForm formId="filters-mobile" filters={filters} facets={{ orgs, countries, categories, types }} action={base} hidden={formHidden} />
          </div>
        </details>
        <div className="sticky top-6 hidden lg:block">
          <FilterForm formId="filters-desktop" filters={filters} facets={{ orgs, countries, categories, types }} action={base} hidden={formHidden} />
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
          {userFilters ? (
            <Link href={base} className="text-sm font-medium text-accent hover:underline">Clear all filters</Link>
          ) : null}
        </div>

        {result.items.length ? (
          <>
            <JobList jobs={result.items.slice(0, 6)} />
            {result.page === 1 ? (
              <div className="my-3 grid items-center gap-4 rounded-xl border border-rule bg-mist p-5 sm:p-6 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="font-display text-xl font-semibold text-ink">Get vacancies like these every week</p>
                  <p className="mt-1 text-sm text-slate">Free Monday email. Unsubscribe with one click.</p>
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
              <Link href="/alerts" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-accent">Get weekly alerts</Link>
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
