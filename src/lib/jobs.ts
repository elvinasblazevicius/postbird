import { ALL_CATEGORIES, categoryBySlug } from "@/config/categories";
import { countryByCode, countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, LANGUAGES, ORG_TYPES, REGIONS, regionBySlug } from "@/config/regions";
import { LISTING_SETTINGS } from "@/config/import";
import { countriesInLocation, DROP_CHARS, FOLD_FROM, FOLD_TO, locationPatterns } from "@/lib/country-match";
import { sql, transaction } from "@/lib/db";
import { GENERAL_SERVICE_TITLE_SQL, LOCAL_ONLY_GRADE_SQL, LOCAL_ONLY_TITLE_SQL, NATIONAL_OFFICER_TITLE_SQL, PROFESSIONAL_TITLE_SQL } from "@/lib/grades";
import { categoriesForWord, foldText, interpretQuery, orgNamesForTerm, placeVariants, searchTerms, wordPattern } from "@/lib/search-intent";

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
  /** Languages (besides English) the posting requires; the language filter uses only these. */
  languages: string[] | null;
  /** Languages (besides English) the posting calls desirable or an advantage. */
  desirable_languages: string[] | null;
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
  /** Country slugs; several are matched as "any of them" together with `region` (one "where" filter). Sorted, no repeats. */
  country?: string[];
  /** Region slugs (see `country`). Sorted, no repeats. */
  region?: string[];
  /** Grade groups ("P", "NO", "entry"…) or exact grades ("P-3"); a listing matches any of them. Sorted, no repeats. */
  grade?: string[];
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

/** Control characters (NUL, line breaks, DEL…): Postgres rejects NUL in text, and none belongs in a filter. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** A query parameter's first value, without control characters and surrounding spaces. */
const first = (v: string | string[] | undefined) => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.replace(CONTROL_CHARS, " ").trim() || undefined : undefined;
};

/** Every value of a parameter that may be repeated, tidied like first() (at most 10). */
const every = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).slice(0, 10).map((x) => first(x)).filter((x): x is string => Boolean(x));

/** The values without repeats, in a fixed (sorted) order, so the same choice always gives the same URL and saved search. */
const tidyList = (xs: string[]): string[] => [...new Set(xs)].sort();

/** URL query parameters (a URLSearchParams or query string) as parseFilters reads them, keeping repeated parameters. */
export function searchParamsRecord(params: URLSearchParams | string): SP {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const out: Record<string, string[]> = {};
  for (const [k, v] of p) (out[k] ??= []).push(v);
  return out;
}

/** Filters from a query string such as a saved search ("grade=P-3&grade=P-4&where=kenya"). */
export function filtersFromQuery(query: string): JobFilters {
  return parseFilters(searchParamsRecord(query));
}

/** Read filters from the URL, ignoring anything invalid. */
export function parseFilters(sp: SP): JobFilters {
  const f: JobFilters = {};
  const q = first(sp.q);
  if (q) f.q = q.slice(0, 120);
  const org = first(sp.org);
  if (org && /^[a-z0-9-]{1,80}$/.test(org)) f.org = org;
  // "where" is the combined region/country field used by the search forms; it, "country", "region"
  // and "grade" may be repeated (where=kenya&where=uganda): a listing then matches any of them.
  const countries: string[] = [];
  const regions: string[] = [];
  for (const where of every(sp.where)) {
    if (where.startsWith("region-") && regionBySlug(where.slice(7))) regions.push(where.slice(7));
    else if (countryBySlug(where)) countries.push(where);
  }
  for (const country of every(sp.country)) if (countryBySlug(country)) countries.push(country);
  for (const region of every(sp.region)) if (regionBySlug(region)) regions.push(region);
  if (countries.length) f.country = tidyList(countries);
  if (regions.length) f.region = tidyList(regions);
  const grades = every(sp.grade).filter((grade) => GRADE_GROUPS.some((g) => g.value === grade) || /^(P|D|NO|G|GS|FS)-[0-9A-E]$|^(ASG|USG)$|^(SB|SC|LICA|NPSA|IPSA|ICS)-\d{1,2}$/.test(grade));
  if (grades.length) f.grade = tidyList(grades);
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
  for (const c of f.country ?? []) p.append("country", c);
  for (const r of f.region ?? []) p.append("region", r);
  for (const g of f.grade ?? []) p.append("grade", g);
  if (f.orgtype) p.set("orgtype", f.orgtype);
  if (f.lang) p.set("lang", f.lang);
  if (f.exp) p.set("exp", f.exp);
  if (f.category) p.set("category", f.category);
  if (f.remote) p.set("remote", "1");
  if (f.type) p.set("type", f.type);
  if (f.posted) p.set("posted", f.posted);
  if (f.closing) p.set("closing", f.closing);
  if (f.hidelocal) p.set("hidelocal", "1");
  // With keywords "Best match" is the default order, so "Newest" has to be in the URL then.
  if (f.sort && (f.sort !== "newest" || f.q)) p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** How many filters are in use; each place and each grade of a multiple choice counts once. */
export function activeFilterCount(f: JobFilters): number {
  const multi = (f.country?.length ?? 0) + (f.region?.length ?? 0) + (f.grade?.length ?? 0);
  return multi + [f.q, f.org, f.orgtype, f.lang, f.exp, f.category, f.remote, f.type, f.posted, f.closing, f.hidelocal].filter(Boolean).length;
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
    grade: f.grade?.length ? f.grade : i.grade ? [i.grade] : undefined,
    country: f.country?.length ? f.country : f.region?.length || !i.country ? undefined : [i.country],
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

/** The search's terms: single words, and organization names of several words kept together (see searchTerms). */
function searchWords(q: string): string[] {
  return searchTerms(q);
}

/** Words this long or longer may also match a title word spelled a little differently ("finanse" → "Finance"). */
const TYPO_MIN_LENGTH = 5;
/** How close a search word must be to a word of the title (pg_trgm word_similarity, 0 to 1; 0.6 is pg_trgm's default). */
const TYPO_TITLE_SIMILARITY = 0.6;
/** How close a word must be to be offered as "Did you mean …?" (pg_trgm similarity). */
const TYPO_SUGGEST_SIMILARITY = 0.4;

/**
 * The loose fallback is tried when a search found nothing and either has two or more words (any of
 * them may match) or is one word long enough to be a misspelling of a title word.
 */
export function wantsLooseMatch(q: string | undefined, total: number): boolean {
  if (total !== 0 || !q) return false;
  const words = searchWords(q);
  return words.length > 1 || (words.length === 1 && foldText(words[0]).length >= TYPO_MIN_LENGTH);
}

/**
 * One search term matches a listing when it appears as a word (not inside another word: "un" never
 * matches "fund") in the title, the organization's name or short name, or the category name, when
 * it is another name of the organization ("msf", "doctors without borders"), or when it is in the
 * indexed text (title, location, grade, type, summary). Accents don't matter on either side:
 * both are folded (pb_fold in db/migrations/007, foldText in src/lib/search-intent.ts).
 */
function wordCondition(t: string): Frag {
  const p = wordPattern(foldText(t));
  let c = sql`(pb_fold(j.title) ~ ${p} or pb_fold(o.name) ~ ${p} or pb_fold(o.short_name) ~ ${p}`;
  const orgNames = orgNamesForTerm(t);
  if (orgNames.length) c = sql`${c} or pb_fold(o.name) = any(${orgNames}) or pb_fold(o.short_name) = any(${orgNames})`;
  const cats = categoriesForWord(t);
  if (cats.length) c = sql`${c} or j.category = any(${cats})`;
  if (/[\p{L}\p{N}]/u.test(t)) c = sql`${c} or j.search_folded @@ plainto_tsquery('simple', ${foldText(t)})`;
  const places = placeTsQuery([t]);
  if (places) c = sql`${c} or j.search_folded @@ to_tsquery('simple', ${places})`;
  return sql`${c})`;
}

/**
 * The other names of the duty stations among these terms (placeVariants: "geneve" → Geneva, Genf…)
 * as a tsquery matched against the location part of the search text only (weight B: location,
 * city, grade, type), so "roma" finds Rome but not "Roma inclusion" in a title. Null when no term
 * is a known duty station. The names come from a fixed list of plain lower-case words.
 */
function placeTsQuery(terms: string[]): string | null {
  const names = [...new Set(terms.flatMap(placeVariants))].filter((n) => /^[a-z]+( [a-z]+)*$/.test(n));
  if (!names.length) return null;
  return names.map((n) => `(${n.split(" ").map((w) => `${w}:B`).join(" <-> ")})`).join(" | ");
}

/** The tsquery the "Best match" order ranks by: the search words, or any other name of a duty station in them. */
function rankQuery(q: string): Frag {
  const places = placeTsQuery(searchWords(q));
  const words = sql`websearch_to_tsquery('simple', ${foldText(q)})`;
  return places ? sql`(${words} || to_tsquery('simple', ${places}))` : words;
}

/**
 * A term in the loose fallback: as wordCondition, or (for words of TYPO_MIN_LENGTH letters or more)
 * a word of the title spelled almost the same way. pb_word_similarity is pg_trgm's word_similarity,
 * or always 0 where the database has no pg_trgm (db/migrations/011).
 */
function looseWordCondition(t: string): Frag {
  const folded = foldText(t);
  if (folded.length < TYPO_MIN_LENGTH || folded.includes(" ")) return wordCondition(t);
  return sql`(${wordCondition(t)} or pb_word_similarity(${folded}, pb_fold(j.title)) >= ${TYPO_TITLE_SIMILARITY})`;
}

function textCondition(q: string, mode: MatchMode): Frag {
  if (mode === "any") {
    const loose = searchWords(q).map(looseWordCondition);
    return loose.length ? sql`(${loose.reduce((a, b) => sql`${a} or ${b}`)})` : sql`true`;
  }
  const parts = searchWords(q).map(wordCondition);
  if (!parts.length) return sql`true`;
  return sql`(j.search_folded @@ websearch_to_tsquery('simple', ${foldText(q)}) or (${parts.reduce((a, b) => sql`${a} and ${b}`)}))`;
}

/**
 * The grade, or for a listing without one the grade group its title names (titleGradeGroup in
 * src/lib/grades.ts): "NO" for National Officer titles, "P" / "G" for IOM's "(P)" / "(G)" suffixes.
 * Used for the grade counts, so such a listing counts once, under its group.
 */
const gradeKey = () => sql`coalesce(j.grade, case
  when lower(j.title) ~ ${NATIONAL_OFFICER_TITLE_SQL} then 'NO'
  when lower(j.title) ~ ${PROFESSIONAL_TITLE_SQL} then 'P'
  when lower(j.title) ~ ${GENERAL_SERVICE_TITLE_SQL} then 'G' end)`;

function gradeCondition(grade: string): Frag {
  const group = GRADE_GROUPS.find((g) => g.value === grade);
  if (group?.value === "SC") return sql`j.grade ~ '^(SB|SC|LICA|NPSA|IPSA|ICS)-'`;
  // A title naming the group counts as that group when no grade was parsed (titleGradeGroup in src/lib/grades.ts).
  if (group?.value === "NO" || group?.value === "P" || group?.value === "G") return sql`(${gradeKey()} = any(${[...group.grades, group.value]}))`;
  if (group) return sql`j.grade = any(${group.grades})`;
  return sql`j.grade = ${grade}`;
}

/** The SQL condition for each filter that is set, keyed by filter. */
function filterConditions(f: JobFilters, mode: MatchMode = "all"): Partial<Record<FilterKey, Frag>> {
  const c: Partial<Record<FilterKey, Frag>> = {};
  if (f.q) c.q = textCondition(f.q, mode);
  if (f.org) c.org = sql`o.slug = ${f.org}`;
  if (f.country?.length || f.region?.length) {
    // Any of the chosen countries and regions (one "where" filter).
    const codes = [
      ...(f.country ?? []).flatMap((s) => countryBySlug(s)?.code ?? []),
      ...(f.region ?? []).flatMap((s) => regionBySlug(s)?.codes ?? []),
    ];
    c.where = codes.length ? placeCondition([...new Set(codes)]) : sql`false`;
  }
  if (f.grade?.length) c.grade = sql`(${f.grade.map(gradeCondition).reduce((a, b) => sql`${a} or ${b}`)})`;
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
  // Same rule as isLocalOnly() in src/lib/grades.ts: the parsed grade, or words in the title.
  if (f.hidelocal) c.hidelocal = sql`(coalesce(j.grade, '') !~ ${LOCAL_ONLY_GRADE_SQL} and lower(j.title) !~ ${LOCAL_ONLY_TITLE_SQL})`;
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
        ? sql`(${searchWords(f.q).map((t) => sql`(${wordCondition(t)})::int * 2 + (${looseWordCondition(t)})::int`).reduce((a, b) => sql`${a} + ${b}`)}) desc, coalesce(j.published_at, j.first_seen_at) desc` :
      sort === "relevance" && f.q ? sql`ts_rank(j.search_folded, ${rankQuery(f.q)}) desc, coalesce(j.published_at, j.first_seen_at) desc, j.id desc` :
      sql`coalesce(j.published_at, j.first_seen_at) desc, j.id desc`;
    // Each in its own short transaction, which carries the statement time limit (see
    // transaction() in src/lib/db.ts); two of them, so the queries still run side by side.
    const [items, [{ count }]] = await Promise.all([
      transaction(async (tx) => await tx<JobListItem[]>`
        select ${listColumns()}
        from jobs j left join organizations o on o.id = j.organization_id
        where ${where}
        order by ${order}
        limit ${pageSize} offset ${(page - 1) * pageSize}`),
      transaction(async (tx) => await tx<{ count: number }[]>`select count(*)::int as count from jobs j left join organizations o on o.id = j.organization_id where ${where}`),
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

/**
 * The "Closing in the next N days" section of a paid alert: open listings (never demo ones) that
 * match ANY of the subscriber's saved searches, with the alerts' own matching (each search as
 * searchJobs reads it, all words, any posting date), whose published closing date is between today
 * (UTC) and `days` days ahead, inclusive. Listings without a closing date never qualify. Leaves out
 * what this subscriber already had in the section (alert_closing_sent) and `excludeIds` (the
 * listings already in the email's new matches). Soonest closing first, at most `limit`.
 */
export async function closingSoonForAlert(opts: { searches: string[]; subscriberId: number; days: number; limit: number; excludeIds?: number[] }): Promise<JobListItem[]> {
  if (!opts.searches.length || opts.limit <= 0) return [];
  const matches = [...new Set(opts.searches)].map((s) => {
    const f = withSearchIntent({ ...filtersFromQuery(s), page: undefined, posted: undefined, sort: undefined });
    return Object.values(filterConditions(f, "all")).reduce<Frag>((w, c) => sql`${w} and ${c}`, sql`true`);
  });
  const anyMatch = matches.reduce((a, b) => sql`${a} or ${b}`);
  const exclude = (opts.excludeIds ?? []).map(Number);
  return transaction(async (tx) => await tx<JobListItem[]>`
    select ${listColumns()}
    from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()} and not j.is_demo
      and j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + ${opts.days}::int
      and (${anyMatch})
      and not exists (select 1 from alert_closing_sent acs where acs.subscriber_id = ${opts.subscriberId} and acs.job_id = j.id)
      ${exclude.length ? sql`and j.id <> all(${exclude}::bigint[])` : sql``}
    order by j.deadline asc, coalesce(j.published_at, j.first_seen_at) desc, j.id desc
    limit ${opts.limit}`);
}

/** Words of the category names and keywords: always offered as "Did you mean …?" even when no open title has them. */
const CATEGORY_VOCABULARY = [...new Set(ALL_CATEGORIES.flatMap((c) => [c.name, ...c.keywords])
  .flatMap((s) => foldText(s.replace(/\*/g, "")).split(/[^a-z0-9]+/))
  .filter((w) => w.length >= TYPO_MIN_LENGTH))];

/**
 * "Did you mean …?" for a search that matched nothing exactly: each word of the search (of
 * TYPO_MIN_LENGTH letters or more) that is not a word of any open listing's title or of the
 * category vocabulary is replaced by the closest such word (pg_trgm similarity). Returns the
 * corrected search, or null when nothing close was found (or the database has no pg_trgm).
 */
export async function searchSuggestion(q: string | undefined): Promise<{ q: string; words: string[] } | null> {
  const text = q ? interpretQuery(q).text : null;
  if (!q || !text) return null;
  const terms = [...new Set(searchWords(text).map(foldText).filter((t) => t.length >= TYPO_MIN_LENGTH && /^[a-z0-9]+$/.test(t)))];
  if (!terms.length) return null;
  const rows = await transaction(async (tx) => await tx<{ term: string; known: boolean; best: string | null }[]>`
    with vocab as materialized (
      select distinct w from (
        select regexp_split_to_table(pb_fold(j.title), '[^a-z0-9]+') as w from jobs j where ${isOpen()}
        union all select unnest(${CATEGORY_VOCABULARY}::text[])
      ) x where length(w) >= ${TYPO_MIN_LENGTH - 1}
    )
    select t.term,
           exists (select 1 from vocab v where v.w = t.term) as known,
           (select v.w from vocab v where pb_similarity(v.w, t.term) >= ${TYPO_SUGGEST_SIMILARITY}
             order by pb_similarity(v.w, t.term) desc, v.w limit 1) as best
    from unnest(${terms}::text[]) as t(term)`);
  let out = q;
  const words: string[] = [];
  for (const r of rows) {
    if (r.known || !r.best || r.best === r.term) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${r.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "giu");
    const next = out.replace(re, `$1${r.best}`);
    if (next !== out) {
      out = next;
      words.push(r.best);
    }
  }
  return words.length ? { q: out, words } : null;
}

/**
 * The newest open listings ("Recently posted" on the home page, the alert example, the fallback
 * under empty results): posts open to international applicants first, local-only ones (the same
 * rule as the "Hide local-only posts" filter) after them; within each, recent UN system posts first.
 * That order only picks WHICH listings are shown: they are returned newest first, as a list headed
 * "Recently posted" reads.
 */
export async function latestJobs(limit = 8) {
  const rows = await sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()}
    order by (coalesce(j.grade, '') ~ ${LOCAL_ONLY_GRADE_SQL} or lower(j.title) ~ ${LOCAL_ONLY_TITLE_SQL}) asc,
             (o.org_type = 'UN system' and coalesce(j.published_at, j.first_seen_at) >= now() - interval '10 days') desc nulls last,
             coalesce(j.published_at, j.first_seen_at) desc, j.id desc
    limit ${limit}`;
  return newestFirst([...rows]);
}

/** Listings newest first (posting date, or first seen when the source gives none; then the newer id). */
export function newestFirst<T extends { id: number; published_at: Date | null; first_seen_at: Date }>(jobs: T[]): T[] {
  const at = (j: T) => new Date(j.published_at ?? j.first_seen_at).getTime();
  return jobs.sort((a, b) => at(b) - at(a) || b.id - a.id);
}

export type WeekInReview = {
  /** Open listings (no demo data) posted in the past 7 days: the same rule as the "Posted: past week" filter. */
  total: number;
  /** The same, by organization type (ORG_TYPES type names), largest first. */
  types: { type: string; count: number }[];
  /** The three organizations with the most of them. */
  orgs: { slug: string; name: string; short_name: string | null; count: number }[];
};

/**
 * Counts for "This week in international jobs" on the home page, computed from the open listings
 * posted in the past 7 days (coalesce(published_at, first_seen_at), as the posted=7 filter, so each
 * number matches the page it links to). Demo listings are left out.
 */
export async function weekInReview(): Promise<WeekInReview> {
  const [r] = await transaction(async (tx) => await tx<{ total: number; types: { k: string; n: number }[]; orgs: { slug: string; name: string; short_name: string | null; n: number }[] }[]>`
    with recent as materialized (
      select o.org_type, o.slug, o.name, o.short_name
      from jobs j left join organizations o on o.id = j.organization_id
      where ${isOpen()} and not j.is_demo and coalesce(j.published_at, j.first_seen_at) >= now() - make_interval(days => 7)
    )
    select
      (select count(*)::int from recent) as total,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select org_type as k, count(*)::int as n from recent where org_type is not null group by 1) x) as types,
      (select coalesce(json_agg(json_build_object('slug', slug, 'name', name, 'short_name', short_name, 'n', n) order by n desc, name), '[]'::json)
         from (select slug, min(name) as name, min(short_name) as short_name, count(*)::int as n from recent where slug is not null
               group by 1 order by count(*) desc, min(name) limit 3) x) as orgs`);
  return {
    total: r.total,
    types: r.types.map((t) => ({ type: t.k, count: t.n })),
    orgs: r.orgs.map((o) => ({ slug: o.slug, name: o.name, short_name: o.short_name, count: o.n })),
  };
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
    select ${listColumns()}, j.languages, j.desirable_languages, j.min_experience_years, j.summary, j.description_html, j.content_policy, j.apply_url, j.apply_host, j.reference,
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

/** The open listings among these ids (the shortlist on /saved; at most 100). */
export async function openJobsByIds(ids: number[]): Promise<JobListItem[]> {
  // At most 12 digits (see parseId in src/lib/site.ts): a larger number would overflow bigint and fail the query.
  const list = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0 && n < 1e12))].slice(0, 100);
  if (!list.length) return [];
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()} and j.id = any(${list})`;
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
  // In a transaction for its statement time limit (see transaction() in src/lib/db.ts).
  const [r] = await transaction(async (tx) => await tx<FacetSnapshot[]>`
    with open as materialized (
      select j.country_code, j.location_text, j.category, ${gradeKey()} as grade, j.languages, j.min_experience_years, j.job_type, j.is_remote,
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
         from open) as stats`);
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
  // In a transaction for its statement time limit (see transaction() in src/lib/db.ts), like facetSnapshot.
  const [r] = await transaction(async (tx) => await tx<{
    orgs: { k: string; nm: string; n: number }[]; places: PlaceRow[]; categories: Count<string>[]; grades: Count<string>[];
    languages: Count<string>[]; experience: Count<number>[]; org_types: Count<string>[]; job_types: Count<string>[];
    without: Partial<Record<FilterKey, number>> | null;
  }[]>`
    with base as materialized (
      select j.country_code, j.location_text, j.category, ${gradeKey()} as grade, j.languages, j.min_experience_years, j.job_type,
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
      ${without ? sql`(select json_build_object(${without}) from base)` : sql`null::json`} as without`);
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
  // Slugs are lower-case letters, digits and hyphens; anything else (e.g. a NUL byte from the URL) is no organization.
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const rows = await sql<{ id: number; slug: string; name: string; short_name: string | null; org_type: string | null; logo: string | null }[]>`
    select id, slug, name, short_name, org_type, case when logo is not null and coalesce(org_type, '') not in ('UN system', 'EU institution') then slug end as logo from organizations where slug = ${slug}`;
  return rows[0] ?? null;
}

export async function hasDemoJobs(): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j where j.is_demo and ${isOpen()}`;
  return r.n > 0;
}
