import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryBySlug } from "@/config/categories";
import { countryBySlug } from "@/config/countries";
import { ORG_TYPES, regionBySlug } from "@/config/regions";
import { gradeLabel } from "@/lib/grades";
import { activeFilterCount, EXPERIENCE_BANDS, filteredFacets, getOrganization, jobsUrl, latestJobs, searchJobs, withSearchIntent, type FilteredFacets, type FilterKey, type JobFilters } from "@/lib/jobs";
import { interpretQuery } from "@/lib/search-intent";
import siteConfig from "@site-config";
import { JobList } from "./job-card";
import { FilterForm } from "./search-forms";
import { TrackedLink } from "./tracking";
import { TrackOnMount } from "./tracking";

function Pagination({ page, pages, filters, base, showLast = true }: { page: number; pages: number; filters: JobFilters; base: string; showLast?: boolean }) {
  if (pages <= 1) return null;
  const nums = new Set([1, ...(showLast ? [pages] : []), page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
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

type Chip = { key: FilterKey; label: string; href: string; fromSearch: boolean };

const POSTED_LABELS: Record<string, string> = { "1": "last 24 hours", "7": "last 7 days", "30": "last 30 days" };

/**
 * The filters in use as removable chips, including those read from the search words ("un internship
 * kenya" → Organization type, Type, Country). Each link removes one filter and keeps the others;
 * filters read from the words are written out as filters in that link, with the words that meant
 * them taken out of the keywords. Filters fixed by a landing page (its path) are not listed.
 */
function filterChips(filters: JobFilters, fixed: Partial<JobFilters>, base: string, facets: FilteredFacets): Chip[] {
  const intent = filters.q ? interpretQuery(filters.q) : null;
  const read = withSearchIntent(filters);
  const own: JobFilters = { ...read, sort: filters.sort, page: undefined };
  for (const k of Object.keys(fixed) as (keyof JobFilters)[]) delete own[k];
  const href = (drop: Partial<Record<keyof JobFilters, undefined>>) => jobsUrl({ ...own, ...drop, page: undefined }, base);
  const fromSearch = (k: "orgtype" | "remote" | "type" | "country") => Boolean(intent && intent[k] !== undefined && !filters[k] && Boolean(read[k]));
  const chips: Chip[] = [];
  if (own.q) chips.push({ key: "q", label: `Keywords: “${own.q}”`, href: href({ q: undefined, sort: undefined }), fromSearch: false });
  if (own.org) chips.push({ key: "org", label: `Organization: ${facets.orgs.find((o) => o.slug === own.org)?.name ?? own.org}`, href: href({ org: undefined }), fromSearch: false });
  if (own.country) chips.push({ key: "where", label: `Country: ${countryBySlug(own.country)?.name ?? own.country}`, href: href({ country: undefined, region: undefined }), fromSearch: fromSearch("country") });
  if (own.region) chips.push({ key: "where", label: `Region: ${regionBySlug(own.region)?.name ?? own.region}`, href: href({ country: undefined, region: undefined }), fromSearch: false });
  if (own.category) chips.push({ key: "category", label: `Category: ${categoryBySlug(own.category)?.name ?? own.category}`, href: href({ category: undefined }), fromSearch: false });
  if (own.grade) chips.push({ key: "grade", label: `Grade: ${gradeLabel(own.grade)}`, href: href({ grade: undefined }), fromSearch: false });
  if (own.type) chips.push({ key: "type", label: `Type: ${own.type}`, href: href({ type: undefined }), fromSearch: fromSearch("type") });
  if (own.orgtype) chips.push({ key: "orgtype", label: `Organization type: ${ORG_TYPES.find((o) => o.value === own.orgtype)?.name ?? own.orgtype}`, href: href({ orgtype: undefined }), fromSearch: fromSearch("orgtype") });
  if (own.remote) chips.push({ key: "remote", label: "Remote / home-based", href: href({ remote: undefined }), fromSearch: fromSearch("remote") });
  if (own.hidelocal) chips.push({ key: "hidelocal", label: "Local-only posts hidden", href: href({ hidelocal: undefined }), fromSearch: false });
  if (own.lang) chips.push({ key: "lang", label: `Language: ${own.lang}`, href: href({ lang: undefined }), fromSearch: false });
  if (own.exp) chips.push({ key: "exp", label: `Experience: ${EXPERIENCE_BANDS.find((b) => b.value === own.exp)?.name ?? own.exp}`, href: href({ exp: undefined }), fromSearch: false });
  if (own.posted) chips.push({ key: "posted", label: `Posted: ${POSTED_LABELS[own.posted]}`, href: href({ posted: undefined }), fromSearch: false });
  if (own.closing) chips.push({ key: "closing", label: `Closing within ${own.closing} days`, href: href({ closing: undefined }), fromSearch: false });
  return chips;
}

function ChipLink({ chip }: { chip: Chip }) {
  return (
    <Link
      href={chip.href}
      aria-label={`Remove filter ${chip.label}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-paper py-1 pl-3 pr-2 text-sm text-ink hover:border-accent hover:text-accent"
    >
      {chip.label}
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </Link>
  );
}

/** Keeps the option chosen in the form visible even when no job matches it with the other filters. */
async function withSelected(f: FilteredFacets, filters: JobFilters): Promise<FilteredFacets> {
  const out = { ...f };
  if (filters.org && !f.orgs.some((o) => o.slug === filters.org)) {
    const org = await getOrganization(filters.org).catch(() => null);
    if (org) out.orgs = [...f.orgs, { slug: org.slug, name: org.name, count: 0 }];
  }
  const c = filters.country ? countryBySlug(filters.country) : undefined;
  if (c && !f.countries.some((x) => x.slug === c.slug)) out.countries = [...f.countries, { code: c.code, slug: c.slug, name: c.name, count: 0 }];
  if (filters.grade && !f.grades.some((g) => g.grade === filters.grade)) out.grades = [...f.grades, { grade: filters.grade, count: 0 }];
  return out;
}

/** Keyword box at the top of the page on phones (the full filter panel is folded away there). */
function MobileKeyword({ filters, base }: { filters: JobFilters; base: string }) {
  const keep = new URLSearchParams(jobsUrl({ ...filters, q: undefined, page: undefined }).split("?")[1] ?? "");
  return (
    <form action={base} method="get" role="search" aria-label="Search by keyword" className="mb-3 flex gap-2 lg:hidden">
      {[...keep].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="mobile-q" className="sr-only">Keywords</label>
      <input
        id="mobile-q"
        name="q"
        type="search"
        defaultValue={filters.q ?? ""}
        placeholder="Title, skill or organization"
        className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 py-2.5 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
      />
      <button type="submit" className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-accent">Search</button>
    </form>
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
  const [result, facetsAll] = await Promise.all([searchJobs(effective, undefined, { looseFallback: true }), filteredFacets(effective)]);
  // Pages past the end (old links, guessed URLs) are a 404 rather than an empty, indexable page.
  if (result.page > result.pages) notFound();
  const facets = await withSelected(result.matchMode === "any" ? await filteredFacets(effective, "any") : facetsAll, filters);
  const hidden: Record<string, string> = {};
  if (fixed.org) hidden.org = fixed.org;
  if (fixed.country) hidden.country = fixed.country;
  if (fixed.region) hidden.region = fixed.region;
  if (fixed.category) hidden.category = fixed.category;
  if (fixed.remote) hidden.remote = "1";
  if (fixed.orgtype) hidden.orgtype = fixed.orgtype;
  // On landing pages the fixed filter is in the path, so don't repeat it in the form.
  const formHidden = base === "/jobs" ? {} : Object.fromEntries(Object.keys(hidden).map((k) => [k, ""]));
  const fallback = result.total === 0 ? await latestJobs(6) : [];
  const userFilters = activeFilterCount(filters);
  const chips = filterChips(filters, fixed, base, facets);
  const from = (result.page - 1) * result.pageSize + 1;
  // The overall total is only shown once the site has enough listings; filtered result counts are always shown.
  const showTotal = userFilters > 0 || result.total >= siteConfig.showVacancyCountFrom;
  const to = from + result.items.length - 1;
  const alertSearch = jobsUrl({ ...effective, page: undefined, sort: undefined }).replace(/^\/jobs\??/, "");
  const removals = chips
    .map((c) => ({ ...c, count: facets.without[c.key] ?? 0 }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside>
        <MobileKeyword filters={filters} base={base} />
        <details className="group/panel rounded-xl border border-rule p-4 lg:hidden" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink [&::-webkit-details-marker]:hidden">
            Filters{userFilters ? ` (${userFilters})` : ""}
            <span className="text-sm text-accent group-open/panel:hidden">Show</span>
            <span className="hidden text-sm text-accent group-open/panel:inline">Hide</span>
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
        {chips.length ? (
          <div className="mb-4">
            <ul className="flex flex-wrap gap-2" aria-label="Filters in use">
              {chips.map((c) => (
                <li key={c.label}><ChipLink chip={c} /></li>
              ))}
            </ul>
            {chips.some((c) => c.fromSearch) ? <p className="mt-2 text-xs text-slate">Some of these filters were read from your search words.</p> : null}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="results-heading" className="font-sans text-base font-medium text-slate">
            {result.total === 0
              ? "No open vacancies match"
              : result.total === 1
                ? "1 open vacancy"
                : showTotal
                  ? `${from}–${to} of ${result.total.toLocaleString("en-US")} open vacancies`
                  : `${result.sort === "deadline" ? "Closing soonest first" : result.sort === "relevance" ? "Best match first" : "Newest first"} · ${from}–${to}`}
          </h2>
          {result.total > 0 ? (
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
          ) : null}
        </div>

        {result.matchMode === "any" ? (
          <p role="status" className="mb-4 rounded-xl border border-rule bg-mist px-4 py-3 text-[0.95rem] text-ink">
            No exact matches. Showing jobs that match some of your words.
          </p>
        ) : null}

        {/* Not for an any-word fallback: alerts match every word, so they would not send these jobs. */}
        {result.total > 0 && result.matchMode === "all" ? (
          <p className="mb-4 flex items-center gap-2 text-[0.95rem] text-ink">
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-accent" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11h11L12 8.5V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            <TrackedLink
              href={`/pricing/trial?search=${encodeURIComponent(alertSearch)}`}
              event="premium_cta_click"
              source="search-alert"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Get new matches for this search by email
            </TrackedLink>
          </p>
        ) : null}

        {result.items.length ? (
          <JobList jobs={result.items} />
        ) : (
          <div className="rounded-xl border border-dashed border-rule p-6 sm:p-8">
            <p className="font-display text-xl text-ink">
              {removals.length ? "No open vacancies match all of these filters together." : "No open vacancies are listed right now."}
            </p>
            {removals.length ? (
              <>
                <p className="mt-2 text-slate">Remove one filter to see what is open:</p>
                <ul className="mt-3 space-y-2">
                  {removals.map((r) => (
                    <li key={r.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link href={r.href} className="inline-flex items-center gap-1.5 rounded-lg border border-rule px-3 py-1.5 text-sm font-medium text-accent hover:bg-mist">
                        Remove {r.label}
                      </Link>
                      <span className="text-sm text-slate">
                        {r.count === 0 ? "still no matches" : r.count === 1 ? "1 open vacancy" : `${r.count.toLocaleString("en-US")} open vacancies`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : emptyHint ? (
              <p className="mt-2 text-slate">{emptyHint}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/jobs" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-accent">See all open vacancies</Link>
              {base !== "/jobs" && removals.length ? (
                <Link href={base} className="rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink hover:bg-mist">Clear filters on this page</Link>
              ) : null}
            </div>
          </div>
        )}
        {fallback.length ? (
          <div className="mt-8">
            <h3 className="mb-3 font-sans text-base font-medium text-slate">Newest vacancies instead</h3>
            <JobList jobs={fallback} />
          </div>
        ) : null}

        <Pagination page={result.page} pages={result.pages} filters={filters} base={base} showLast={showTotal} />
        {userFilters > 0 && result.page === 1 ? (
          <TrackOnMount event={{ type: "search", props: { ...effective, results: result.total, match: result.matchMode } }} />
        ) : null}
      </section>
    </div>
  );
}
