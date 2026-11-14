import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryBySlug } from "@/config/categories";
import { countryBySlug } from "@/config/countries";
import { ORG_TYPES, regionBySlug } from "@/config/regions";
import { andList, orList, placeNames, resultsHeading, STATED_DETAIL } from "@/lib/filter-labels";
import { gradeLabel } from "@/lib/grades";
import { activeFilterCount, countDated, countJobs, derivedFilters, EXPERIENCE_BANDS, filteredFacets, getOrganizations, jobsUrl, latestJobs, searchJobs, searchSuggestion, withSearchIntent, type FilteredFacets, type FilterKey, type JobFilters } from "@/lib/jobs";
import { interpretQuery } from "@/lib/search-intent";
import { BILLING_LIVE } from "@/lib/billing/live";
import { CLOSING_SOON_DAYS } from "@/lib/email-templates";
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
        <Link rel="prev" href={jobsUrl({ ...filters, page: page - 1 }, base)} className="inline-flex items-center rounded-lg border border-rule px-3 py-2 text-sm text-ink hover:bg-mist max-sm:min-h-11">Previous</Link>
      ) : null}
      {list.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {i > 0 && n - list[i - 1] > 1 ? <span className="px-1 text-slate">…</span> : null}
          <Link
            href={jobsUrl({ ...filters, page: n }, base)}
            aria-current={n === page ? "page" : undefined}
            className={`inline-flex min-w-10 items-center justify-center rounded-lg px-3 py-2 text-center text-sm max-sm:min-h-11 max-sm:min-w-11 ${n === page ? "bg-brand font-semibold text-white" : "border border-rule text-ink hover:bg-mist"}`}
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pages ? (
        <Link rel="next" href={jobsUrl({ ...filters, page: page + 1 }, base)} className="inline-flex items-center rounded-lg border border-rule px-3 py-2 text-sm text-ink hover:bg-mist max-sm:min-h-11">Next</Link>
      ) : null}
    </nav>
  );
}

type Chip = { key: FilterKey | "unstated"; label: string; href: string; fromSearch: boolean };
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
  const fromSearch = (k: "orgtype" | "remote" | "type" | "country" | "region" | "grade" | "lang") => {
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
  const orgs = own.org ?? [];
  const orgName = (slug: string) => facets.orgs.find((o) => o.slug === slug)?.name ?? slug;
  for (const o of orgs) chips.push({ key: "org", label: `Organization: ${orgName(o)}`, href: href({ org: without(orgs, o) }), fromSearch: false });
  if (orgs.length) removals.push({ key: "org", label: orgs.length > 1 ? `Organization: ${orList(orgs.map(orgName))}` : chips[chips.length - 1].label, href: href({ org: undefined }) });
  const regions = own.region ?? [];
  const countries = own.country ?? [];
  for (const r of regions) chips.push({ key: "where", label: `Region: ${regionBySlug(r)?.name ?? r}`, href: href({ region: without(regions, r) }), fromSearch: fromSearch("region") });
  for (const c of countries) chips.push({ key: "where", label: `Country: ${countryBySlug(c)?.name ?? c}`, href: href({ country: without(countries, c) }), fromSearch: fromSearch("country") });
  if (regions.length + countries.length) {
    removals.push({ key: "where", label: regions.length + countries.length > 1 ? `Location: ${orList(placeNames(own))}` : chips[chips.length - 1].label, href: href({ country: undefined, region: undefined }) });
  }
  const grades = own.grade ?? [];
  for (const g of grades) chips.push({ key: "grade", label: `Grade: ${gradeLabel(g)}`, href: href({ grade: without(grades, g) }), fromSearch: fromSearch("grade") });
  if (grades.length) removals.push({ key: "grade", label: `Grade: ${orList(grades.map(gradeLabel))}`, href: href({ grade: undefined }) });
  // Category, contract type and organization type: one chip per choice, like grades.
  const multiChips = (key: "category" | "type" | "orgtype" | "lang" | "exp", label: string, name: (v: string) => string, search = false) => {
    const list = own[key] ?? [];
    for (const v of list) chips.push({ key, label: `${label}: ${name(v)}`, href: href({ [key]: without(list, v) }), fromSearch: search });
    if (list.length) removals.push({ key, label: `${label}: ${orList(list.map(name))}`, href: href({ [key]: undefined }) });
  };
  multiChips("category", "Category", (v) => categoryBySlug(v)?.name ?? v);
  multiChips("type", "Type", (v) => v, fromSearch("type"));
  multiChips("orgtype", "Organization type", (v) => ORG_TYPES.find((o) => o.value === v)?.name ?? v, fromSearch("orgtype"));
  if (own.remote) single("remote", "Remote / home-based", { remote: undefined }, fromSearch("remote"));
  if (own.hidelocal) single("hidelocal", "Local-only posts hidden", { hidelocal: undefined });
  multiChips("lang", "Language", (v) => `${v} mentioned`, fromSearch("lang"));
  multiChips("exp", "Experience", (v) => EXPERIENCE_BANDS.find((b) => b.value === v)?.name ?? v);
  if (own.posted) single("posted", `Posted: ${POSTED_LABELS[own.posted]}`, { posted: undefined });
  if (own.closing) single("closing", `Closing within ${own.closing} days`, { closing: undefined });
  // Not a removal for the empty state: it only ever adds listings.
  const derived = derivedFilters(own);
  if (own.unstated && derived.length) {
    chips.push({ key: "unstated", label: `Including vacancies that don't state ${orList(derived.map((k) => STATED_DETAIL[k]))}`, href: href({ unstated: undefined }), fromSearch: false });
  }
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
  const missing = (filters.org ?? []).filter((slug) => !f.orgs.some((o) => o.slug === slug));
  if (missing.length) {
    const orgs = await getOrganizations(missing).catch(() => []);
    out.orgs = [...f.orgs, ...orgs.map((o) => ({ slug: o.slug, name: o.name, count: 0 }))];
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
        placeholder="Job title or keyword"
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
/** The yellow "get alerts" button: the one bright action next to search results. */
const ALERT_BUTTON = "inline-flex min-h-10 items-center rounded-lg bg-highlight px-3.5 py-1.5 text-[0.95rem] font-semibold text-ink no-underline shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)] hover:brightness-95";

export async function JobsBrowser({
  filters,
  fixed = {},
  base = "/jobs",
  emptyHint,
  alertNoun,
  emptyTitle,
  generalAlert = false,
}: {
  filters: JobFilters;
  fixed?: Partial<JobFilters>;
  base?: string;
  emptyHint?: React.ReactNode;
  /** What the empty-results email offer calls these vacancies: "Get an email when new {UNICEF} vacancies are posted". */
  alertNoun?: string;
  /** The empty state's heading when no filter is set (instead of "No open vacancies are listed right now."). */
  emptyTitle?: string;
  /** The empty-results email offer is the general one (no search, no noun): e.g. a landing page with no listings at all. */
  generalAlert?: boolean;
}) {
  // A landing page fixed to a place (/locations/kenya) replaces every place in the URL rather than adding to them.
  const effective: JobFilters = { ...filters, ...fixed, ...(fixed.country || fixed.region ? { country: fixed.country, region: fixed.region } : {}) };
  const [result, facetsAll] = await Promise.all([searchJobs(effective, undefined, { looseFallback: true }), filteredFacets(effective)]);
  // Pages past the end (old links, guessed URLs) are a 404 rather than an empty, indexable page.
  if (result.page > result.pages) notFound();
  const facets = await withSelected(result.matchMode === "any" ? await filteredFacets(effective, "any") : facetsAll, filters);
  const hidden: Record<string, string> = {};
  if (fixed.org) hidden.org = fixed.org.join(",");
  if (fixed.country) hidden.country = fixed.country.join(",");
  if (fixed.region) hidden.region = fixed.region.join(",");
  if (fixed.category?.length) hidden.category = fixed.category.join(",");
  if (fixed.remote) hidden.remote = "1";
  if (fixed.orgtype?.length) hidden.orgtype = fixed.orgtype.join(",");
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
  const alertPage = siteConfig.freeWeeklyEmail ? "/alerts" : "/pricing/trial";
  const alertHref = generalAlert ? alertPage : `${alertPage}?search=${encodeURIComponent(alertSearch)}`;
  const noun = generalAlert ? "" : [userFilters > 0 ? "matching" : null, alertNoun].filter(Boolean).join(" ");
  const removals = removalList
    .map((c) => ({ ...c, count: facets.without[c.key] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  // "Did you mean finance?" when the words matched nothing exactly (or only loosely).
  const suggestion = filters.q && (result.total === 0 || result.matchMode === "any") ? await searchSuggestion(filters.q).catch(() => null) : null;
  const suggestionHref = suggestion ? jobsUrl({ ...filters, q: suggestion.q, page: undefined }, base) : null;
  // Filters read from the posting's text leave out listings that don't state the detail: say how many, with a way to add them.
  // Not for a detail read from the search words ("russian", "consultancy"): a vacancy that doesn't
  // state it doesn't hold the word, and a result always holds the search words.
  const fromWords = withSearchIntent(effective).fromWords ?? {};
  const derived = derivedFilters(effective).filter((k) => !(k in fromWords && fromWords[k as keyof typeof fromWords]));
  const unstatedMore = derived.length && !effective.unstated
    ? Math.max(0, (await countJobs({ ...effective, unstated: true }, result.matchMode).catch(() => result.total)) - result.total)
    : 0;
  const unstatedHref = unstatedMore ? jobsUrl({ ...filters, unstated: true, page: undefined }, base) : null;
  // Next to the alert button: how many of these results publish a closing date (the ones a closing-date reminder can cover).
  const dated = result.total > 0 && result.matchMode === "all" && userFilters > 0 ? await countDated(effective).catch(() => null) : null;

  // The alert button and closing-date coverage for a search with exact matches (not an any-word fallback: alerts match every word,
  // so they would not send those jobs). Above the results on wide screens; on phones after the first three cards.
  const alertRow = result.total > 0 && result.matchMode === "all" ? (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink">
      {siteConfig.freeWeeklyEmail ? (
        // One short link: the alerts page offers the free weekly email and daily alerts for this search.
        <Link href={`/alerts?search=${encodeURIComponent(alertSearch)}`} className={`-my-1 ${ALERT_BUTTON}`}>
          Get alerts for this search
        </Link>
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
      {dated !== null && BILLING_LIVE ? (
        <span className="text-slate">
          {dated === result.total
            ? result.total === 1 ? "It has a published closing date." : `All ${result.total.toLocaleString("en-US")} have a published closing date.`
            : `${dated.toLocaleString("en-US")} of these ${result.total.toLocaleString("en-US")} have a published closing date.`}
          {dated > 0 ? ` Daily alerts remind you ${CLOSING_SOON_DAYS} days before ${dated === 1 ? "it closes" : "each one closes"}.` : ""}
        </span>
      ) : null}
    </div>
  ) : null;

  // The forms' boxes are set from the address when drawn: a new address (a removed chip, Back) draws them afresh.
  const formKey = jobsUrl({ ...filters, page: undefined }, base);
  // grid-cols-1 (minmax(0, 1fr)): on 320px phones the search field's own width can't widen the column past the screen.
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr] lg:gap-8">
      <aside>
        <MobileKeyword key={`k:${formKey}`} filters={filters} formId="filters-mobile" />
        <details className="group/panel rounded-xl border border-rule p-4 lg:hidden" open={false}>
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink [&::-webkit-details-marker]:hidden">
            Filters{userFilters ? ` (${userFilters})` : ""}
            <span className="text-sm text-accent group-open/panel:hidden">Show</span>
            <span className="hidden text-sm text-accent group-open/panel:inline">Hide</span>
          </summary>
          <div className="mt-4">
            <FilterForm key={`m:${formKey}`} formId="filters-mobile" filters={filters} facets={facets} action={base} hidden={formHidden} submitOnChange={false} keyword={false} />
          </div>
        </details>
        <div className="filter-scroll sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain pb-1 pr-2 lg:block">
          <FilterForm key={`d:${formKey}`} formId="filters-desktop" filters={filters} facets={facets} action={base} hidden={formHidden} />
        </div>
      </aside>

      {/* The search on this page, for the header's "Get job alerts" button (src/components/site-nav.tsx). */}
      <div hidden data-alert-search={generalAlert ? "" : alertSearch} />
      <section aria-labelledby="results-heading">
        {chips.length ? (
          // On phones the keyword is already in the search box above: its chip is left out there (and the row, when it is the only one).
          <div className={`mb-4 ${chips.every((c) => c.key === "q") ? "max-lg:hidden" : ""}`}>
            <ul className="flex flex-wrap gap-2" aria-label="Filters in use">
              {chips.map((c) => (
                <li key={c.label} className={c.key === "q" ? "max-lg:hidden" : undefined}><ChipLink chip={c} /></li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="results-heading" className="font-sans text-[1.05rem] font-semibold text-ink">
            {/* A fallback (some of the words, or similar words) never reads as a match. */}
            {result.matchMode === "any"
              ? `No exact matches · ${result.total.toLocaleString("en-US")} similar ${result.total === 1 ? "vacancy" : "vacancies"}`
              : resultsHeading({ total: result.total, from, to, pages: result.pages, sort: result.sort, showTotal })}
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
                    className={`inline-flex items-center rounded-full px-3 py-1 max-sm:min-h-11 ${active ? "bg-brand text-white" : "text-accent hover:bg-tint"}`}
                  >
                    {o.label}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        {unstatedHref ? (
          <p className="mb-3 text-sm text-slate" title={`Only vacancies that state ${andList(derived.map((k) => STATED_DETAIL[k]))} are shown.`}>
            <Link href={unstatedHref} className="font-medium text-accent underline underline-offset-2">
              + {unstatedMore.toLocaleString("en-US")} that don&apos;t state {andList(derived.map((k) => STATED_DETAIL[k]))}
            </Link>
          </p>
        ) : null}

        {result.matchMode === "any" ? (
          <div role="status" className="mb-4 rounded-xl border border-rule bg-mist px-4 py-3 text-[0.95rem] text-ink">
            <p>
              No vacancy has all your words. Showing those with some of them.
              {suggestion && suggestionHref ? (
                <> Did you mean <Link href={suggestionHref} className="font-medium text-accent underline underline-offset-2">{suggestion.q}</Link>?</>
              ) : null}
            </p>
            {/* The alert follows every word, so it is the way to hear about an exact match when one is posted. */}
            <Link href={alertHref} className={`mt-3 ${ALERT_BUTTON}`}>Email me when an exact match is posted</Link>
          </div>
        ) : null}

        {alertRow ? <div className="max-sm:hidden">{alertRow}</div> : null}

        {result.items.length ? (
          <JobList jobs={result.items} phoneExtra={alertRow ? { after: 3, node: <div className="rounded-xl bg-sky-wash p-3 [&>div]:mb-0">{alertRow}</div> } : undefined} />
        ) : (
          <div className="rounded-xl border border-dashed border-rule p-6 sm:p-8">
            <p className="font-display text-xl text-ink">
              {removals.length > 1
                ? "No open vacancies match all of these filters together."
                : removals.length === 1
                  ? `No open vacancies match ${removals[0].phrase ?? removals[0].label}.`
                  : emptyTitle ?? "No open vacancies are listed right now."}
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
            {/* One way out per destination: with a single filter, "Remove …" above already leads to this page
                without it (all open vacancies on /jobs), so the same link isn't offered twice. */}
            {/* Nothing open now: the email when one is posted is the main next step, the ways out come after it. */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href={alertHref} className={ALERT_BUTTON}>
                Email me when new {noun ? `${noun} ` : ""}vacancies are posted
              </Link>
              {removals.length === 1 && base === "/jobs" ? null : (
                <Link href="/jobs" className="inline-flex min-h-10 items-center rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink hover:bg-mist">See all open vacancies</Link>
              )}
              {base !== "/jobs" && removals.length > 1 ? (
                <Link href={base} className="inline-flex min-h-10 items-center rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink hover:bg-mist">Clear filters on this page</Link>
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
          <TrackOnMount event={{ type: "search", props: { ...effective, org: effective.org?.join(","), country: effective.country?.join(","), region: effective.region?.join(","), grade: effective.grade?.join(","), results: result.total, match: result.matchMode } }} />
        ) : null}
      </section>
    </div>
  );
}
