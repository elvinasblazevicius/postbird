import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryBySlug } from "@/config/categories";
import { countryBySlug } from "@/config/countries";
import { ORG_TYPES, regionBySlug } from "@/config/regions";
import { orList, placeNames } from "@/lib/filter-labels";
import { gradeLabel } from "@/lib/grades";
import { activeFilterCount, EXPERIENCE_BANDS, filteredFacets, getOrganization, jobsUrl, latestJobs, searchJobs, searchSuggestion, withSearchIntent, type FilteredFacets, type FilterKey, type JobFilters } from "@/lib/jobs";
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
/** One "remove a filter" suggestion of the empty state: a whole filter, even when it holds several values. */
type Removal = { key: FilterKey; label: string; href: string; /** How the empty state names it when it is the only filter. */ phrase?: string };

const POSTED_LABELS: Record<string, string> = { "1": "last 24 hours", "7": "last 7 days", "30": "last 30 days" };

/**
 * The filters in use as removable chips, including those read from the search words ("un internship
 * kenya" → Organization type, Type, Country). Each link removes one filter (or one value of a filter
 * that holds several, such as two countries) and keeps the others; filters read from the words are
 * written out as filters in that link, with the words that meant them taken out of the keywords.
 * Filters fixed by a landing page (its path) are not listed. Also returns, for the empty state, one
 * removal per filter (all of its values at once).
 */
function filterChips(filters: JobFilters, fixed: Partial<JobFilters>, base: string, facets: FilteredFacets): { chips: Chip[]; removals: Removal[] } {
  const intent = filters.q ? interpretQuery(filters.q) : null;
  const read = withSearchIntent(filters);
  const own: JobFilters = { ...read, sort: filters.sort, page: undefined };
  for (const k of Object.keys(fixed) as (keyof JobFilters)[]) delete own[k];
  const href = (change: Partial<JobFilters>) => jobsUrl({ ...own, ...change, page: undefined }, base);
  const without = (list: string[] | undefined, v: string) => {
    const rest = (list ?? []).filter((x) => x !== v);
    return rest.length ? rest : undefined;
  };
  const fromSearch = (k: "orgtype" | "remote" | "type" | "country" | "grade") => {
    const set = filters[k];
    return Boolean(intent && intent[k] !== undefined && !(Array.isArray(set) ? set.length : set) && Boolean(read[k]));
  };
  const chips: Chip[] = [];
  const removals: Removal[] = [];
  const single = (key: FilterKey, label: string, change: Partial<JobFilters>, search = false, phrase?: string) => {
    const h = href(change);
    chips.push({ key, label, href: h, fromSearch: search });
    removals.push({ key, label, href: h, phrase });
  };
  if (own.q) single("q", `Keywords: “${own.q}”`, { q: undefined, sort: undefined }, false, `“${own.q}”`);
  if (own.org) single("org", `Organization: ${facets.orgs.find((o) => o.slug === own.org)?.name ?? own.org}`, { org: undefined });
  const regions = own.region ?? [];
  const countries = own.country ?? [];
  for (const r of regions) chips.push({ key: "where", label: `Region: ${regionBySlug(r)?.name ?? r}`, href: href({ region: without(regions, r) }), fromSearch: false });
  for (const c of countries) chips.push({ key: "where", label: `Country: ${countryBySlug(c)?.name ?? c}`, href: href({ country: without(countries, c) }), fromSearch: fromSearch("country") });
  if (regions.length + countries.length) {
    removals.push({ key: "where", label: regions.length + countries.length > 1 ? `Location: ${orList(placeNames(own))}` : chips[chips.length - 1].label, href: href({ country: undefined, region: undefined }) });
  }
  const grades = own.grade ?? [];
  for (const g of grades) chips.push({ key: "grade", label: `Grade: ${gradeLabel(g)}`, href: href({ grade: without(grades, g) }), fromSearch: fromSearch("grade") });
  if (grades.length) removals.push({ key: "grade", label: `Grade: ${orList(grades.map(gradeLabel))}`, href: href({ grade: undefined }) });
  if (own.category) single("category", `Category: ${categoryBySlug(own.category)?.name ?? own.category}`, { category: undefined });
  if (own.type) single("type", `Type: ${own.type}`, { type: undefined }, fromSearch("type"));
  if (own.orgtype) single("orgtype", `Organization type: ${ORG_TYPES.find((o) => o.value === own.orgtype)?.name ?? own.orgtype}`, { orgtype: undefined }, fromSearch("orgtype"));
  if (own.remote) single("remote", "Remote / home-based", { remote: undefined }, fromSearch("remote"));
  if (own.hidelocal) single("hidelocal", "Local-only posts hidden", { hidelocal: undefined });
  if (own.lang) single("lang", `Language: ${own.lang} mentioned`, { lang: undefined });
  if (own.exp) single("exp", `Experience: ${EXPERIENCE_BANDS.find((b) => b.value === own.exp)?.name ?? own.exp}`, { exp: undefined });
  if (own.posted) single("posted", `Posted: ${POSTED_LABELS[own.posted]}`, { posted: undefined });
  if (own.closing) single("closing", `Closing within ${own.closing} days`, { closing: undefined });
  return { chips, removals };
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
  for (const slug of filters.country ?? []) {
    const c = countryBySlug(slug);
    if (c && !out.countries.some((x) => x.slug === c.slug)) out.countries = [...out.countries, { code: c.code, slug: c.slug, name: c.name, count: 0 }];
  }
  for (const grade of filters.grade ?? []) if (!out.grades.some((g) => g.grade === grade)) out.grades = [...out.grades, { grade, count: 0 }];
  return out;
}

/**
 * Keyword box at the top of the page on phones (the full filter panel is folded away there). Its
 * field and button belong to the phone filter panel's form (the `form` attribute), so the keyword
 * and the filters are sent together whichever button is used, and there is only one keyword field.
 */
function MobileKeyword({ filters, formId }: { filters: JobFilters; formId: string }) {
  return (
    <div role="search" aria-label="Search by keyword" className="mb-3 flex gap-2 lg:hidden">
      <label htmlFor="mobile-q" className="sr-only">Keywords</label>
      <input
        id="mobile-q"
        name="q"
        form={formId}
        type="search"
        defaultValue={filters.q ?? ""}
        placeholder="Title, skill or organization"
        className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 py-2.5 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
      />
      <button type="submit" form={formId} className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-accent">Search</button>
    </div>
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
  alertNoun,
}: {
  filters: JobFilters;
  fixed?: Partial<JobFilters>;
  base?: string;
  emptyHint?: React.ReactNode;
  /** What the empty-results email offer calls these vacancies: "Get an email when new {UNICEF} vacancies are posted". */
  alertNoun?: string;
}) {
  // A landing page fixed to a place (/locations/kenya) replaces every place in the URL rather than adding to them.
  const effective: JobFilters = { ...filters, ...fixed, ...(fixed.country || fixed.region ? { country: fixed.country, region: fixed.region } : {}) };
  const [result, facetsAll] = await Promise.all([searchJobs(effective, undefined, { looseFallback: true }), filteredFacets(effective)]);
  // Pages past the end (old links, guessed URLs) are a 404 rather than an empty, indexable page.
  if (result.page > result.pages) notFound();
  const facets = await withSelected(result.matchMode === "any" ? await filteredFacets(effective, "any") : facetsAll, filters);
  const hidden: Record<string, string> = {};
  if (fixed.org) hidden.org = fixed.org;
  if (fixed.country) hidden.country = fixed.country.join(",");
  if (fixed.region) hidden.region = fixed.region.join(",");
  if (fixed.category) hidden.category = fixed.category;
  if (fixed.remote) hidden.remote = "1";
  if (fixed.orgtype) hidden.orgtype = fixed.orgtype;
  // On landing pages the fixed filter is in the path, so don't repeat it in the form.
  const formHidden = base === "/jobs" ? {} : Object.fromEntries(Object.keys(hidden).map((k) => [k, ""]));
  const fallback = result.total === 0 ? await latestJobs(6) : [];
  const userFilters = activeFilterCount(filters);
  const { chips, removals: removalList } = filterChips(filters, fixed, base, facets);
  const from = (result.page - 1) * result.pageSize + 1;
  // The overall total is always shown on /jobs and on filtered results; elsewhere (landing pages
  // without filters) only once the site has enough listings. The homepage has its own rule.
  const showTotal = base === "/jobs" || userFilters > 0 || result.total >= siteConfig.showVacancyCountFrom;
  const to = from + result.items.length - 1;
  const alertSearch = jobsUrl({ ...effective, page: undefined, sort: undefined }).replace(/^\/jobs\??/, "");
  const alertHref = `${siteConfig.freeWeeklyEmail ? "/alerts" : "/pricing/trial"}?search=${encodeURIComponent(alertSearch)}`;
  const noun = [userFilters > 0 ? "matching" : null, alertNoun].filter(Boolean).join(" ");
  const removals = removalList
    .map((c) => ({ ...c, count: facets.without[c.key] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  // "Did you mean finance?" when the words matched nothing exactly (or only loosely).
  const suggestion = filters.q && (result.total === 0 || result.matchMode === "any") ? await searchSuggestion(filters.q).catch(() => null) : null;
  const suggestionHref = suggestion ? jobsUrl({ ...filters, q: suggestion.q, page: undefined }, base) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside>
        <MobileKeyword filters={filters} formId="filters-mobile" />
        <details className="group/panel rounded-xl border border-rule p-4 lg:hidden" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink [&::-webkit-details-marker]:hidden">
            Filters{userFilters ? ` (${userFilters})` : ""}
            <span className="text-sm text-accent group-open/panel:hidden">Show</span>
            <span className="hidden text-sm text-accent group-open/panel:inline">Hide</span>
          </summary>
          <div className="mt-4">
            <FilterForm formId="filters-mobile" filters={filters} facets={facets} action={base} hidden={formHidden} submitOnChange={false} keyword={false} />
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
                  ? `Showing ${from}–${to} of ${result.total.toLocaleString("en-US")} open vacancies`
                  : `${result.sort === "deadline" ? "Closing soonest first" : result.sort === "relevance" ? "Best match first" : "Newest first"} · ${from}–${to}`}
          </h2>
          {result.total > 0 ? (
            <div className="flex items-center gap-1 text-sm" aria-label="Sort">
              <span className="mr-1 text-slate">Sort:</span>
              {[
                // "Best match" (the default with keywords) only when words are left to rank by.
                ...(filters.q && interpretQuery(filters.q).text ? [{ key: "relevance", label: "Best match" }] : []),
                { key: "newest", label: "Newest" },
                { key: "deadline", label: "Closing soonest" },
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
            No exact matches. Showing jobs that match some of your words or similar words.
            {suggestion && suggestionHref ? (
              <> Did you mean <Link href={suggestionHref} className="font-medium text-accent underline underline-offset-2">{suggestion.q}</Link>?</>
            ) : null}
          </p>
        ) : null}

        {/* Not for an any-word fallback: alerts match every word, so they would not send these jobs. */}
        {result.total > 0 && result.matchMode === "all" ? (
          <p className="mb-4 flex items-start gap-2 text-[0.95rem] text-ink">
            <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11h11L12 8.5V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            {siteConfig.freeWeeklyEmail ? (
              <span>
                <Link href={`/alerts?search=${encodeURIComponent(alertSearch)}`} className="font-medium text-accent underline-offset-2 hover:underline">
                  Get new matches for this search in a free weekly email
                </Link>
                <span className="text-slate"> · or </span>
                <TrackedLink
                  href={`/pricing/trial?search=${encodeURIComponent(alertSearch)}`}
                  event="premium_cta_click"
                  source="search-alert"
                  className="text-slate underline underline-offset-2 hover:text-accent"
                >
                  daily alerts (paid plan)
                </TrackedLink>
              </span>
            ) : (
              <TrackedLink
                href={`/pricing/trial?search=${encodeURIComponent(alertSearch)}`}
                event="premium_cta_click"
                source="search-alert"
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                Get new matches for this search by email
              </TrackedLink>
            )}
          </p>
        ) : null}

        {result.items.length ? (
          <JobList jobs={result.items} />
        ) : (
          <div className="rounded-xl border border-dashed border-rule p-6 sm:p-8">
            <p className="font-display text-xl text-ink">
              {removals.length > 1
                ? "No open vacancies match all of these filters together."
                : removals.length === 1
                  ? `No open vacancies match ${removals[0].phrase ?? removals[0].label}.`
                  : "No open vacancies are listed right now."}
            </p>
            {suggestion && suggestionHref ? (
              <p className="mt-2 text-ink">
                Did you mean <Link href={suggestionHref} className="font-medium text-accent underline underline-offset-2">{suggestion.q}</Link>?
              </p>
            ) : null}
            {removals.length ? (
              <>
                <p className="mt-2 text-slate">{removals.length > 1 ? "Remove one filter to see what is open:" : "Remove it to see what is open:"}</p>
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
            <p className="mt-5 flex items-start gap-2 border-t border-rule pt-4 text-[0.95rem] text-ink">
              <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11h11L12 8.5V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              <Link href={alertHref} className="font-medium text-accent underline-offset-2 hover:underline">
                Get an email when new {noun ? `${noun} ` : ""}vacancies are posted
              </Link>
            </p>
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
          <TrackOnMount event={{ type: "search", props: { ...effective, country: effective.country?.join(","), region: effective.region?.join(","), grade: effective.grade?.join(","), results: result.total, match: result.matchMode } }} />
        ) : null}
      </section>
    </div>
  );
}
