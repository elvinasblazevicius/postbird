import { ALL_CATEGORIES, categoryBySlug } from "@/config/categories";
import { countryByCode, countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, LANGUAGES, ORG_TYPES, REGIONS, regionBySlug } from "@/config/regions";
import { LISTING_SETTINGS } from "@/config/import";
import { countriesInLocation, DROP_CHARS, FOLD_FROM, FOLD_TO, locationPatterns } from "@/lib/country-match";
import { sql } from "@/lib/db";
import { LOCAL_ONLY_GRADE_SQL } from "@/lib/grades";
import { categoriesForWord, interpretQuery, wordPattern } from "@/lib/search-intent";

export type JobListItem = {
  id: number;
  slug: string;
  title: string;
  org_name: string | null;
  org_slug: string | null;
  org_short: string | null;
  /** Organization slug when it has a stored icon (served from /api/org-logo/<slug>). */
  org_logo: string | null;
  country_code: string | null;
  city: string | null;
  location_text: string | null;
  is_remote: boolean | null;
  category: string;
  job_type: string | null;
  grade: string | null;
  published_at: Date | null;
  first_seen_at: Date;
  deadline: string | null;
  status: string;
  is_demo: boolean;
};

export type JobDetail = JobListItem & {
  languages: string[] | null;
  min_experience_years: number | null;
  summary: string | null;
  description_html: string | null;
  content_policy: string;
  apply_url: string;
  apply_host: string;
  reference: string | null;
  org_type: string | null;
  updated_at: Date;
  last_seen_at: Date;
  sources: { source_title: string | null; feed_name: string; item_url: string | null }[];
};

export const JOB_TYPES = ["Fixed-term", "Temporary", "Consultancy", "Internship", "Fellowship", "Volunteer", "Part-time"] as const;

export const EXPERIENCE_BANDS = [
  { value: "0-2", name: "Up to 2 years", min: 0, max: 2 },
  { value: "3-5", name: "3–5 years", min: 3, max: 5 },
  { value: "6-9", name: "6–9 years", min: 6, max: 9 },
  { value: "10+", name: "10 years or more", min: 10, max: 99 },
] as const;

export type JobFilters = {
  q?: string;
  org?: string;
  country?: string; // country slug
  region?: string; // region slug
  grade?: string; // grade group ("P", "NO", "entry"…) or exact grade ("P-3")
  orgtype?: string;
  lang?: string;
  exp?: string;
  category?: string;
  remote?: boolean;
  type?: string;
  posted?: "1" | "7" | "30";
  closing?: "7" | "30";
  /** Leave out posts usually open only to nationals or residents of the duty-station country (see src/lib/grades.ts). */
  hidelocal?: boolean;
  sort?: "newest" | "deadline" | "relevance";
  page?: number;
  /** Email alerts only (never read from the URL): first seen after / up to these times, and no demo listings. */
  firstSeenAfter?: Date;
  firstSeenUntil?: Date;
  excludeDemo?: boolean;
};

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Read filters from the URL, ignoring anything invalid. */
export function parseFilters(sp: SP): JobFilters {
  const f: JobFilters = {};
  const q = first(sp.q);
  if (q) f.q = q.slice(0, 120);
  const org = first(sp.org);
  if (org && /^[a-z0-9-]{1,80}$/.test(org)) f.org = org;
  // "where" is the combined region/country field used by the search forms.
  const where = first(sp.where);
  if (where?.startsWith("region-") && regionBySlug(where.slice(7))) f.region = where.slice(7);
  else if (where && countryBySlug(where)) f.country = where;
  const country = first(sp.country);
  if (country && countryBySlug(country)) f.country = country;
  const region = first(sp.region);
  if (region && regionBySlug(region)) f.region = region;
  const grade = first(sp.grade);
  if (grade && (GRADE_GROUPS.some((g) => g.value === grade) || /^(P|D|NO|G|GS|FS)-[0-9A-E]$|^(ASG|USG)$|^(SB|SC|LICA|NPSA|IPSA|ICS)-\d{1,2}$/.test(grade))) f.grade = grade;
  const orgtype = first(sp.orgtype);
  if (orgtype && ORG_TYPES.some((o) => o.value === orgtype)) f.orgtype = orgtype;
  const lang = first(sp.lang);
  if (lang && (LANGUAGES as readonly string[]).includes(lang)) f.lang = lang;
  const exp = first(sp.exp);
  if (exp && EXPERIENCE_BANDS.some((b) => b.value === exp)) f.exp = exp;
  const category = first(sp.category);
  if (category && categoryBySlug(category)) f.category = category;
  if (first(sp.remote) === "1" || first(sp.remote) === "true") f.remote = true;
  const type = first(sp.type);
  if (type && (JOB_TYPES as readonly string[]).includes(type)) f.type = type;
  const posted = first(sp.posted);
  if (posted === "1" || posted === "7" || posted === "30") f.posted = posted;
  const closing = first(sp.closing);
  if (closing === "7" || closing === "30") f.closing = closing;
  if (first(sp.hidelocal) === "1") f.hidelocal = true;
  const sort = first(sp.sort);
  if (sort === "deadline" || sort === "relevance" || sort === "newest") f.sort = sort;
  const page = Number(first(sp.page));
  if (Number.isInteger(page) && page > 1 && page < 1000) f.page = page;
  return f;
}

/** Build a shareable /jobs URL for a set of filters. */
export function jobsUrl(f: JobFilters, base = "/jobs"): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.org) p.set("org", f.org);
  if (f.country) p.set("country", f.country);
  if (f.region) p.set("region", f.region);
  if (f.grade) p.set("grade", f.grade);
  if (f.orgtype) p.set("orgtype", f.orgtype);
  if (f.lang) p.set("lang", f.lang);
  if (f.exp) p.set("exp", f.exp);
  if (f.category) p.set("category", f.category);
  if (f.remote) p.set("remote", "1");
  if (f.type) p.set("type", f.type);
  if (f.posted) p.set("posted", f.posted);
  if (f.closing) p.set("closing", f.closing);
  if (f.hidelocal) p.set("hidelocal", "1");
  if (f.sort && f.sort !== "newest") p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function activeFilterCount(f: JobFilters): number {
  return [f.q, f.org, f.country, f.region, f.grade, f.orgtype, f.lang, f.exp, f.category, f.remote, f.type, f.posted, f.closing, f.hidelocal].filter(Boolean).length;
}

/** A listing is shown while active and not past its published closing date (checked at query time, between syncs). */
const isOpen = () => sql`j.status = 'active' and (j.deadline is null or j.deadline >= (now() at time zone 'utc')::date)`;

type Frag = ReturnType<typeof isOpen>;

/** Apply what the search words mean ("un", "remote", "internship", a country) as filters. */
export function withSearchIntent(f: JobFilters): JobFilters {
  if (!f.q) return f;
  const i = interpretQuery(f.q);
  return {
    ...f,
    q: i.text ?? undefined,
    orgtype: f.orgtype ?? i.orgtype,
    remote: f.remote || i.remote || undefined,
    type: f.type ?? i.type,
    country: f.country ?? (f.region ? undefined : i.country),
    sort: !i.text && f.sort === "relevance" ? undefined : f.sort,
  };
}

const listColumns = () => sql`
  j.id::int as id, j.slug, j.title, o.name as org_name, o.slug as org_slug, o.short_name as org_short,
  case when o.logo is not null and coalesce(o.org_type, '') not in ('UN system', 'EU institution') then o.slug end as org_logo,
  j.country_code, j.city, j.location_text, j.is_remote, j.category, j.job_type, j.grade,
  j.published_at, j.first_seen_at, j.deadline::text as deadline, j.status, j.is_demo`;

/** The location text normalized exactly like normalizePlace() in src/lib/country-match.ts. */
const FOLD_FROM_SQL = [...FOLD_FROM].join("") + [...FOLD_FROM].map((c) => c.toUpperCase()).join("") + DROP_CHARS;
const FOLD_TO_SQL = FOLD_TO + FOLD_TO;
const placeText = () =>
  sql`(' ' || regexp_replace(translate(lower(coalesce(j.location_text, '')), ${FOLD_FROM_SQL}, ${FOLD_TO_SQL}), '[^a-z0-9]+', ' ', 'g') || ' ')`;

/**
 * Jobs in any of these countries: the listing's country, or a country its
 * location text names (a listing for "Nairobi, Kenya; Kampala, Uganda" is in both).
 */
export function placeCondition(codes: string[]): Frag {
  const p = locationPatterns(codes);
  if (!p) return sql`j.country_code = any(${codes})`;
  return sql`(j.country_code = any(${codes}) or regexp_replace(${placeText()}, ${p.strip}, ' ', 'g') ~ ${p.match})`;
}

/** The filters a visitor can set (and remove one at a time). */
export const FILTER_KEYS = ["q", "org", "where", "grade", "orgtype", "lang", "exp", "category", "remote", "type", "posted", "closing", "hidelocal"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** "all": every search word must match (the normal search). "any": at least one word (the fallback when nothing matches all). */
export type MatchMode = "all" | "any";

function searchWords(q: string): string[] {
  return q.split(" ").filter(Boolean).slice(0, 8);
}

/** The any-word fallback is tried only when an all-words search of two or more words found nothing. */
export function wantsLooseMatch(q: string | undefined, total: number): boolean {
  return total === 0 && Boolean(q) && searchWords(q!).length > 1;
}

/**
 * One search word matches a listing when it appears as a word (not inside another word: "un" never
 * matches "fund") in the title, the organization's name or short name, or the category name, or
 * when it is in the indexed text (title, location, grade, type, summary).
 */
function wordCondition(t: string): Frag {
  const p = wordPattern(t);
  let c = sql`(j.title ~* ${p} or coalesce(o.name, '') ~* ${p} or coalesce(o.short_name, '') ~* ${p}`;
  const cats = categoriesForWord(t);
  if (cats.length) c = sql`${c} or j.category = any(${cats})`;
  if (/[\p{L}\p{N}]/u.test(t)) c = sql`${c} or j.search_vector @@ plainto_tsquery('simple', ${t})`;
  return sql`${c})`;
}

function textCondition(q: string, mode: MatchMode): Frag {
  const parts = searchWords(q).map(wordCondition);
  if (!parts.length) return sql`true`;
  if (mode === "any") return sql`(${parts.reduce((a, b) => sql`${a} or ${b}`)})`;
  return sql`(j.search_vector @@ websearch_to_tsquery('simple', ${q}) or (${parts.reduce((a, b) => sql`${a} and ${b}`)}))`;
}

function gradeCondition(grade: string): Frag {
  const group = GRADE_GROUPS.find((g) => g.value === grade);
  if (group?.value === "SC") return sql`j.grade ~ '^(SB|SC|LICA|NPSA|IPSA|ICS)-'`;
  if (group) return sql`j.grade = any(${group.grades})`;
  return sql`j.grade = ${grade}`;
}

/** The SQL condition for each filter that is set, keyed by filter. */
function filterConditions(f: JobFilters, mode: MatchMode = "all"): Partial<Record<FilterKey, Frag>> {
  const c: Partial<Record<FilterKey, Frag>> = {};
  if (f.q) c.q = textCondition(f.q, mode);
  if (f.org) c.org = sql`o.slug = ${f.org}`;
  if (f.country || f.region) {
    const country = f.country ? countryBySlug(f.country) : undefined;
    const region = f.region ? regionBySlug(f.region) : undefined;
    const parts = [
      ...(f.country ? [country ? placeCondition([country.code]) : sql`false`] : []),
      ...(f.region ? [region ? placeCondition(region.codes) : sql`false`] : []),
    ];
    c.where = parts.reduce((a, b) => sql`${a} and ${b}`);
  }
  if (f.grade) c.grade = gradeCondition(f.grade);
  if (f.orgtype) c.orgtype = sql`o.org_type = ${ORG_TYPES.find((o) => o.value === f.orgtype)?.type ?? "--"}`;
  if (f.lang) c.lang = sql`${f.lang} = any(j.languages)`;
  if (f.exp) {
    const band = EXPERIENCE_BANDS.find((b) => b.value === f.exp)!;
    c.exp = sql`j.min_experience_years between ${band.min} and ${band.max}`;
  }
  if (f.category) c.category = sql`j.category = ${f.category}`;
  if (f.remote) c.remote = sql`j.is_remote is true`;
  if (f.type) c.type = sql`j.job_type = ${f.type}`;
  if (f.posted) c.posted = sql`coalesce(j.published_at, j.first_seen_at) >= now() - make_interval(days => ${Number(f.posted)})`;
  if (f.closing) c.closing = sql`j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + ${Number(f.closing)}::int`;
  if (f.hidelocal) c.hidelocal = sql`(j.grade is null or j.grade !~ ${LOCAL_ONLY_GRADE_SQL})`;
  return c;
}

/** Open listings plus the alert-only limits (never set from the URL). */
function baseCondition(f: JobFilters): Frag {
  let w = isOpen();
  if (f.firstSeenAfter) w = sql`${w} and j.first_seen_at > ${f.firstSeenAfter}`;
  if (f.firstSeenUntil) w = sql`${w} and j.first_seen_at <= ${f.firstSeenUntil}`;
  if (f.excludeDemo) w = sql`${w} and not j.is_demo`;
  return w;
}

function whereFor(f: JobFilters, mode: MatchMode = "all") {
  return Object.values(filterConditions(f, mode)).reduce<Frag>((w, c) => sql`${w} and ${c}`, baseCondition(f));
}

/**
 * Search results. With `looseFallback` (the jobs pages, never the email alerts), a search of several
 * words that matches nothing is run again matching ANY of the words; `matchMode` then says "any" so
 * the page can say so.
 */
export async function searchJobs(input: JobFilters, pageSize: number = LISTING_SETTINGS.pageSize, opts: { looseFallback?: boolean } = {}) {
  const f = withSearchIntent(input);
  const page = f.page ?? 1;
  const sort = f.sort ?? (f.q ? "relevance" : "newest");
  const run = async (mode: MatchMode) => {
    const where = whereFor(f, mode);
    const order =
      sort === "deadline" ? sql`j.deadline asc nulls last, coalesce(j.published_at, j.first_seen_at) desc` :
      sort === "relevance" && f.q && mode === "any"
        ? sql`(${searchWords(f.q).map((t) => sql`(${wordCondition(t)})::int`).reduce((a, b) => sql`${a} + ${b}`)}) desc, coalesce(j.published_at, j.first_seen_at) desc` :
      sort === "relevance" && f.q ? sql`ts_rank(j.search_vector, websearch_to_tsquery('simple', ${f.q})) desc, coalesce(j.published_at, j.first_seen_at) desc` :
      sql`coalesce(j.published_at, j.first_seen_at) desc, j.id desc`;
    const [items, [{ count }]] = await Promise.all([
      sql<JobListItem[]>`
        select ${listColumns()}
        from jobs j left join organizations o on o.id = j.organization_id
        where ${where}
        order by ${order}
        limit ${pageSize} offset ${(page - 1) * pageSize}`,
      sql<{ count: number }[]>`select count(*)::int as count from jobs j left join organizations o on o.id = j.organization_id where ${where}`,
    ]);
    return { items, total: Number(count) };
  };
  let matchMode: MatchMode = "all";
  let res = await run("all");
  if (opts.looseFallback && wantsLooseMatch(f.q, res.total)) {
    const loose = await run("any");
    if (loose.total > 0) {
      res = loose;
      matchMode = "any";
    }
  }
  return { ...res, page, pageSize, pages: Math.max(1, Math.ceil(res.total / pageSize)), sort, matchMode };
}

export async function latestJobs(limit = 8) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()}
    order by (o.org_type = 'UN system' and coalesce(j.published_at, j.first_seen_at) >= now() - interval '10 days') desc nulls last,
             coalesce(j.published_at, j.first_seen_at) desc, j.id desc
    limit ${limit}`;
}

/** Open jobs with the nearest published closing dates (from today). */
export async function closingSoonJobs(limit = 6) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()} and j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + 14
    order by j.deadline asc, coalesce(j.published_at, j.first_seen_at) desc limit ${limit}`;
}

export async function getJob(id: number): Promise<JobDetail | null> {
  const rows = await sql<JobDetail[]>`
    select ${listColumns()}, j.languages, j.min_experience_years, j.summary, j.description_html, j.content_policy, j.apply_url, j.apply_host, j.reference,
           o.org_type, j.updated_at, j.last_seen_at
    from jobs j left join organizations o on o.id = j.organization_id
    where j.id = ${id}`;
  const job = rows[0];
  if (!job) return null;
  job.sources = await sql<JobDetail["sources"]>`
    select s.source_title, f.name as feed_name, s.item_url from job_sources s join feeds f on f.id = s.feed_id
    where s.job_id = ${id} order by s.first_seen_at`;
  return job;
}

export async function similarJobs(job: JobDetail, limit = 4) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()} and j.id <> ${job.id} and (j.category = ${job.category} or o.slug = ${job.org_slug ?? "--"})
    order by (o.slug = ${job.org_slug ?? "--"}) desc nulls last, coalesce(j.published_at, j.first_seen_at) desc limit ${limit}`;
}

// ── Facets & stats ───────────────────────────────────────────

export async function organizationFacets(limit = 500, includeDemo = true) {
  return sql<{ slug: string; name: string; short_name: string | null; org_type: string | null; logo: string | null; count: number }[]>`
    select o.slug, o.name, o.short_name, o.org_type, case when o.logo is not null and coalesce(o.org_type, '') not in ('UN system', 'EU institution') then o.slug end as logo, count(*)::int as count
    from jobs j join organizations o on o.id = j.organization_id
    where ${isOpen()} and (${includeDemo} or not j.is_demo) group by o.id order by count(*) desc, o.name limit ${limit}`;
}

type Count<K> = { k: K; n: number };
type PlaceRow = { c: string | null; l: string | null; n: number };
type FacetSnapshot = {
  places: PlaceRow[];
  categories: Count<string>[];
  grades: Count<string>[];
  languages: Count<string>[];
  experience: Count<number>[];
  org_types: Count<string>[];
  job_types: Count<string>[];
  stats: { active: number; orgs: number; countries: number; remote: number; this_week: number };
};

/** Snapshot queries still running, so callers at the same moment share one. */
const snapshotsInFlight = new Map<boolean, Promise<FacetSnapshot>>();

/**
 * Every count the filters and the homepage show, in ONE query over the open
 * listings. The facet functions below all read it, and calls made while it is
 * running share it: a page that asks for eight kinds of counts at once (the
 * homepage, the job lists) runs one query instead of eight (see the pool-size
 * note in src/lib/db.ts). Nothing is kept once the query has finished.
 */
function facetSnapshot(includeDemo: boolean): Promise<FacetSnapshot> {
  let p = snapshotsInFlight.get(includeDemo);
  if (!p) {
    p = queryFacetSnapshot(includeDemo).finally(() => snapshotsInFlight.delete(includeDemo));
    snapshotsInFlight.set(includeDemo, p);
  }
  return p;
}

async function queryFacetSnapshot(includeDemo: boolean): Promise<FacetSnapshot> {
  const [r] = await sql<FacetSnapshot[]>`
    with open as materialized (
      select j.country_code, j.location_text, j.category, j.grade, j.languages, j.min_experience_years, j.job_type, j.is_remote,
             j.organization_id, coalesce(j.published_at, j.first_seen_at) as posted, o.org_type
      from jobs j left join organizations o on o.id = j.organization_id
      where ${isOpen()} and (${includeDemo} or not j.is_demo)
    )
    select
      (select coalesce(json_agg(json_build_object('c', c, 'l', l, 'n', n)), '[]'::json)
         from (select country_code as c, location_text as l, count(*)::int as n from open group by 1, 2) x) as places,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n)), '[]'::json)
         from (select category as k, count(*)::int as n from open group by 1) x) as categories,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by k), '[]'::json)
         from (select grade as k, count(*)::int as n from open where grade is not null group by 1) x) as grades,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select l as k, count(*)::int as n from open, unnest(open.languages) l group by 1) x) as languages,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n)), '[]'::json)
         from (select min_experience_years as k, count(*)::int as n from open where min_experience_years is not null group by 1) x) as experience,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n)), '[]'::json)
         from (select org_type as k, count(*)::int as n from open where org_type is not null group by 1) x) as org_types,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select job_type as k, count(*)::int as n from open where job_type is not null group by 1) x) as job_types,
      (select json_build_object(
                'active', count(*)::int,
                'orgs', count(distinct organization_id)::int,
                'countries', count(distinct country_code)::int,
                'remote', (count(*) filter (where is_remote))::int,
                'this_week', (count(*) filter (where posted >= now() - interval '7 days'))::int)
         from open) as stats`;
  return r;
}

/**
 * Country and region counts from (country, location text, count) rows. A listing counts under its
 * own country and every country its location text names, the same rule the filter uses
 * (placeCondition), so a listing for two countries is counted under both. A region counts each
 * listing once.
 */
function placeCounts(rows: PlaceRow[]) {
  const countries = new Map<string, number>();
  const regions = new Map<string, number>();
  for (const r of rows) {
    const codes = new Set(countriesInLocation(r.l));
    if (r.c) codes.add(r.c);
    for (const c of codes) countries.set(c, (countries.get(c) ?? 0) + r.n);
    for (const reg of REGIONS) if (reg.codes.some((c) => codes.has(c))) regions.set(reg.slug, (regions.get(reg.slug) ?? 0) + r.n);
  }
  return {
    countries: [...countries]
      .map(([code, count]) => ({ country: countryByCode(code), code, count }))
      .filter((r) => r.country)
      .map((r) => ({ code: r.code, slug: r.country!.slug, name: r.country!.name, count: r.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    regions: REGIONS.map((r) => ({ slug: r.slug, name: r.name, count: regions.get(r.slug) ?? 0 })),
  };
}

export async function countryFacets(includeDemo = true) {
  return placeCounts((await facetSnapshot(includeDemo)).places).countries;
}

export async function categoryFacets(includeDemo = true) {
  const { categories } = await facetSnapshot(includeDemo);
  const counts = new Map(categories.map((r) => [r.k, r.n]));
  return ALL_CATEGORIES.map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }));
}

/** Region counts (the same snapshot, no extra query). */
export async function regionFacets(includeDemo = true) {
  return placeCounts((await facetSnapshot(includeDemo)).places).regions;
}

export async function gradeFacets() {
  return (await facetSnapshot(true)).grades.map((r) => ({ grade: r.k, count: r.n }));
}

export async function languageFacets() {
  return (await facetSnapshot(true)).languages.map((r) => ({ lang: r.k, count: r.n }));
}

export async function experienceFacets() {
  const rows = (await facetSnapshot(true)).experience;
  return EXPERIENCE_BANDS.map((b) => ({ ...b, count: rows.filter((r) => r.k >= b.min && r.k <= b.max).reduce((n, r) => n + r.n, 0) }));
}

export async function orgTypeFacets() {
  const rows = (await facetSnapshot(true)).org_types;
  return ORG_TYPES.map((t) => ({ ...t, count: rows.find((r) => r.k === t.type)?.n ?? 0 }));
}

export async function jobTypeFacets() {
  return (await facetSnapshot(true)).job_types.map((r) => ({ job_type: r.k, count: r.n }));
}

export async function siteStats() {
  return (await facetSnapshot(true)).stats;
}

// ── Facets for the current filters ───────────────────────────

export type FilteredFacets = {
  orgs: { slug: string; name: string; count: number }[];
  countries: { code: string; slug: string; name: string; count: number }[];
  regions: { slug: string; name: string; count: number }[];
  categories: { slug: string; name: string; count: number }[];
  grades: { grade: string; count: number }[];
  types: { job_type: string; count: number }[];
  langs: { lang: string; count: number }[];
  exps: { value: string; name: string; count: number }[];
  orgTypes: { value: string; name: string; count: number }[];
  /** For each filter that is set: how many listings match once that one filter is removed. */
  without: Partial<Record<FilterKey, number>>;
};

/**
 * Option counts for the filter form that reflect the other filters in use: the count beside
 * "Kenya" is what you get by choosing Kenya while keeping everything else. Each facet leaves
 * out its own filter, so you can switch between its options. One query over the open listings.
 * `mode` is the match mode the results used (see searchJobs).
 */
export async function filteredFacets(input: JobFilters, mode: MatchMode = "all"): Promise<FilteredFacets> {
  const f = withSearchIntent(input);
  const conds = filterConditions(f, mode);
  const active = FILTER_KEYS.filter((k) => conds[k]);
  const flag = (k: FilterKey) => conds[k] ?? sql`true`;
  // Static column names for each filter's yes/no flag.
  const col: Record<FilterKey, Frag> = {
    q: sql`c_q`, org: sql`c_org`, where: sql`c_where`, grade: sql`c_grade`, orgtype: sql`c_orgtype`, lang: sql`c_lang`, exp: sql`c_exp`,
    category: sql`c_category`, remote: sql`c_remote`, type: sql`c_type`, posted: sql`c_posted`, closing: sql`c_closing`, hidelocal: sql`c_hidelocal`,
  };
  const except = (skip?: FilterKey) => active.filter((k) => k !== skip).reduce<Frag>((a, k) => sql`${a} and ${col[k]}`, sql`true`);
  const without = active.length
    ? active.map((k) => sql`${k}::text, (count(*) filter (where ${except(k)}))::int`).reduce((a, b) => sql`${a}, ${b}`)
    : null;
  const [r] = await sql<{
    orgs: { k: string; nm: string; n: number }[]; places: PlaceRow[]; categories: Count<string>[]; grades: Count<string>[];
    languages: Count<string>[]; experience: Count<number>[]; org_types: Count<string>[]; job_types: Count<string>[];
    without: Partial<Record<FilterKey, number>> | null;
  }[]>`
    with base as materialized (
      select j.country_code, j.location_text, j.category, j.grade, j.languages, j.min_experience_years, j.job_type,
             o.slug as org_slug, o.name as org_name, o.org_type,
             (${flag("q")}) as c_q, (${flag("org")}) as c_org, (${flag("where")}) as c_where, (${flag("grade")}) as c_grade,
             (${flag("orgtype")}) as c_orgtype, (${flag("lang")}) as c_lang, (${flag("exp")}) as c_exp, (${flag("category")}) as c_category,
             (${flag("remote")}) as c_remote, (${flag("type")}) as c_type, (${flag("posted")}) as c_posted, (${flag("closing")}) as c_closing,
             (${flag("hidelocal")}) as c_hidelocal
      from jobs j left join organizations o on o.id = j.organization_id
      where ${baseCondition(f)}
    )
    select
      (select coalesce(json_agg(json_build_object('k', k, 'nm', nm, 'n', n) order by n desc, nm), '[]'::json)
         from (select org_slug as k, min(org_name) as nm, count(*)::int as n from base where org_slug is not null and ${except("org")} group by 1) x) as orgs,
      (select coalesce(json_agg(json_build_object('c', c, 'l', l, 'n', n)), '[]'::json)
         from (select country_code as c, location_text as l, count(*)::int as n from base where ${except("where")} group by 1, 2) x) as places,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n)), '[]'::json)
         from (select category as k, count(*)::int as n from base where ${except("category")} group by 1) x) as categories,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by k), '[]'::json)
         from (select grade as k, count(*)::int as n from base where grade is not null and ${except("grade")} group by 1) x) as grades,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select l as k, count(*)::int as n from base, unnest(base.languages) l where ${except("lang")} group by 1) x) as languages,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n)), '[]'::json)
         from (select min_experience_years as k, count(*)::int as n from base where min_experience_years is not null and ${except("exp")} group by 1) x) as experience,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n)), '[]'::json)
         from (select org_type as k, count(*)::int as n from base where org_type is not null and ${except("orgtype")} group by 1) x) as org_types,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select job_type as k, count(*)::int as n from base where job_type is not null and ${except("type")} group by 1) x) as job_types,
      ${without ? sql`(select json_build_object(${without}) from base)` : sql`null::json`} as without`;
  const places = placeCounts(r.places);
  const cats = new Map(r.categories.map((x) => [x.k, x.n]));
  return {
    orgs: r.orgs.map((o) => ({ slug: o.k, name: o.nm, count: o.n })),
    countries: places.countries,
    regions: places.regions,
    categories: ALL_CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, count: cats.get(c.slug) ?? 0 })),
    grades: r.grades.map((g) => ({ grade: g.k, count: g.n })),
    types: r.job_types.map((t) => ({ job_type: t.k, count: t.n })),
    langs: r.languages.map((l) => ({ lang: l.k, count: l.n })),
    exps: EXPERIENCE_BANDS.map((b) => ({ value: b.value, name: b.name, count: r.experience.filter((e) => e.k >= b.min && e.k <= b.max).reduce((n, e) => n + e.n, 0) })),
    orgTypes: ORG_TYPES.map((t) => ({ value: t.value, name: t.name, count: r.org_types.find((x) => x.k === t.type)?.n ?? 0 })),
    without: r.without ?? {},
  };
}

export async function getOrganization(slug: string) {
  const rows = await sql<{ id: number; slug: string; name: string; short_name: string | null; org_type: string | null; logo: string | null }[]>`
    select id, slug, name, short_name, org_type, case when logo is not null and coalesce(org_type, '') not in ('UN system', 'EU institution') then slug end as logo from organizations where slug = ${slug}`;
  return rows[0] ?? null;
}

export async function hasDemoJobs(): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j where j.is_demo and ${isOpen()}`;
  return r.n > 0;
}
