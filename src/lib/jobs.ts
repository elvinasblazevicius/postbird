import { stripBoardText } from "@/lib/board-text";
import { cache } from "react";
import { ALL_CATEGORIES, categoryBySlug } from "@/config/categories";
import { countryByCode, countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, LANGUAGES, ORG_TYPES, REGIONS, regionBySlug, regionOf } from "@/config/regions";
import { LISTING_SETTINGS } from "@/config/import";
import { countriesInLocation, DROP_CHARS, FOLD_FROM, FOLD_TO, locationPatterns } from "@/lib/country-match";
import { sql, transaction } from "@/lib/db";
import { logoProtectedSql } from "@/lib/feeds/logos";
import { GENERAL_SERVICE_TITLE_SQL, gradeGroupOf, LOCAL_ONLY_GRADE_SQL, LOCAL_ONLY_TITLE_SQL, NATIONAL_OFFICER_TITLE_SQL, NO_LEVEL_CAPS_SQL, PROFESSIONAL_TITLE_SQL, titleGradeGroup } from "@/lib/grades";
import { ABBREVIATIONS, categoriesForWord, foldText, gradeTitlePattern, interpretQuery, orgNamesForTerm, placeVariants, queryWords, searchTerms, singular, wordPattern, type QueryWords } from "@/lib/search-intent";

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
  /** The employer's vacancy page (the card's Apply button); absent where a list is built without it. */
  apply_url?: string | null;
  /** For the card: minimum years of experience the posting asks for, required languages, organization type. */
  min_experience_years?: number | null;
  languages?: string[] | null;
  org_type?: string | null;
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

export const JOB_TYPES = ["Fixed-term", "Temporary", "Consultancy", "Internship", "Traineeship", "Fellowship", "Volunteer", "Part-time", "Contract agent", "Temporary agent"] as const;

export const EXPERIENCE_BANDS = [
  { value: "0-2", name: "Up to 2 years", min: 0, max: 2 },
  { value: "3-5", name: "3–5 years", min: 3, max: 5 },
  { value: "6-9", name: "6–9 years", min: 6, max: 9 },
  { value: "10+", name: "10 years or more", min: 10, max: 99 },
] as const;

export type JobFilters = {
  q?: string;
  /** Organization slugs; a listing at any of them matches. Sorted, no repeats. */
  org?: string[];
  /** Country slugs; several are matched as "any of them" together with `region` (one "where" filter). Sorted, no repeats. */
  country?: string[];
  /** Region slugs (see `country`). Sorted, no repeats. */
  region?: string[];
  /** Grade groups ("P", "NO", "entry"…) or exact grades ("P-3"); a listing matches any of them. Sorted, no repeats. */
  grade?: string[];
  /** Organization types (ORG_TYPES values); any of them matches. Sorted, no repeats. */
  orgtype?: string[];
  /** Languages mentioned in the requirements; any of them matches. Sorted, no repeats. */
  lang?: string[];
  /** Experience bands (EXPERIENCE_BANDS values); any of them matches. Sorted, no repeats. */
  exp?: string[];
  /** Category slugs; any of them matches. Sorted, no repeats. */
  category?: string[];
  remote?: boolean;
  /** Contract types (JOB_TYPES); any of them matches. Sorted, no repeats. */
  type?: string[];
  posted?: "1" | "7" | "30";
  closing?: "7" | "30";
  /** Leave out posts usually open only to nationals or residents of the duty-station country (see src/lib/grades.ts). */
  hidelocal?: boolean;
  /**
   * With the grade, experience, language or contract-type filter: also match listings that don't
   * state that detail (see DERIVED_FILTERS). Kept only while one of those filters is in use.
   */
  unstated?: boolean;
  sort?: "newest" | "deadline" | "relevance";
  page?: number;
  /**
   * Set by withSearchIntent, never read from the URL: the search words a filter was read from
   * (their TITLE match counts too, see QueryWords), and phrases typed in double quotes.
   */
  fromWords?: QueryWords["from"];
  exact?: string[];
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

/** Every value of a parameter that may be repeated, tidied like first() (at most 40: no filter offers more choices). */
const every = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).slice(0, 40).map((x) => first(x)).filter((x): x is string => Boolean(x));

/** Slugs are lower case: "IOM" or "Kenya" typed into an address still pick the organization or place. */
const slugs = (v: string | string[] | undefined): string[] => every(v).map((x) => x.toLowerCase());

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
  const orgs = slugs(sp.org).filter((org) => /^[a-z0-9-]{1,80}$/.test(org));
  if (orgs.length) f.org = tidyList(orgs);
  // "where" is the combined region/country field used by the search forms; it, "country", "region"
  // and "grade" may be repeated (where=kenya&where=uganda): a listing then matches any of them.
  const countries: string[] = [];
  const regions: string[] = [];
  for (const where of slugs(sp.where)) {
    if (where.startsWith("region-") && regionBySlug(where.slice(7))) regions.push(where.slice(7));
    else if (countryBySlug(where)) countries.push(where);
  }
  for (const country of slugs(sp.country)) if (countryBySlug(country)) countries.push(country);
  for (const region of slugs(sp.region)) if (regionBySlug(region)) regions.push(region);
  if (countries.length) f.country = tidyList(countries);
  if (regions.length) f.region = tidyList(regions);
  const grades = every(sp.grade).map((g) => g.toUpperCase()).map((g) => GRADE_GROUPS.find((x) => x.value.toUpperCase() === g)?.value ?? g).filter((grade) => GRADE_GROUPS.some((g) => g.value === grade || g.grades.includes(grade)) || /^(P|D|NO|G|GS|FS)-[0-9A-E]$|^(ASG|USG)$|^(SB|SC|LICA|NPSA|IPSA|ICS)-\d{1,2}$/.test(grade));
  if (grades.length) f.grade = tidyList(grades);
  const orgtypes = slugs(sp.orgtype).filter((o) => ORG_TYPES.some((t) => t.value === o));
  if (orgtypes.length) f.orgtype = tidyList(orgtypes);
  const langs = every(sp.lang).flatMap((l) => (LANGUAGES as readonly string[]).find((x) => x.toLowerCase() === l.toLowerCase()) ?? []);
  if (langs.length) f.lang = tidyList(langs);
  const exps = every(sp.exp).filter((e) => EXPERIENCE_BANDS.some((b) => b.value === e));
  if (exps.length) f.exp = tidyList(exps);
  const categories = slugs(sp.category).filter((c) => categoryBySlug(c));
  if (categories.length) f.category = tidyList(categories);
  if (["1", "true", "yes"].includes((first(sp.remote) ?? "").toLowerCase())) f.remote = true;
  const types = every(sp.type).flatMap((t) => (JOB_TYPES as readonly string[]).find((k) => k.toLowerCase() === t.toLowerCase()) ?? []);
  if (types.length) f.type = tidyList(types);
  const posted = first(sp.posted);
  if (posted === "1" || posted === "7" || posted === "30") f.posted = posted;
  const closing = first(sp.closing);
  if (closing === "7" || closing === "30") f.closing = closing;
  if (first(sp.hidelocal) === "1") f.hidelocal = true;
  if (first(sp.unstated) === "1" && derivedFilters(f).length) f.unstated = true;
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
  for (const o of f.org ?? []) p.append("org", o);
  for (const c of f.country ?? []) p.append("country", c);
  for (const r of f.region ?? []) p.append("region", r);
  for (const g of f.grade ?? []) p.append("grade", g);
  for (const o of f.orgtype ?? []) p.append("orgtype", o);
  for (const l of f.lang ?? []) p.append("lang", l);
  for (const e of f.exp ?? []) p.append("exp", e);
  for (const c of f.category ?? []) p.append("category", c);
  if (f.remote) p.set("remote", "1");
  for (const t of f.type ?? []) p.append("type", t);
  if (f.posted) p.set("posted", f.posted);
  if (f.closing) p.set("closing", f.closing);
  if (f.hidelocal) p.set("hidelocal", "1");
  if (f.unstated && derivedFilters(f).length) p.set("unstated", "1");
  // With keywords "Best match" is the default order, so "Newest" has to be in the URL then.
  if (f.sort && (f.sort !== "newest" || f.q)) p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/** How many filters are in use; each place, grade and organization of a multiple choice counts once. */
export function activeFilterCount(f: JobFilters): number {
  const multi = [f.country, f.region, f.grade, f.org, f.orgtype, f.category, f.type, f.lang, f.exp].reduce((n, l) => n + (l?.length ?? 0), 0);
  return multi + [f.q, f.remote, f.posted, f.closing, f.hidelocal].filter(Boolean).length;
}

/** A listing is shown while active and not past its published closing date (checked at query time, between syncs). */
const isOpen = () => sql`j.status = 'active' and (j.deadline is null or j.deadline >= (now() at time zone 'utc')::date)`;

type Frag = ReturnType<typeof isOpen>;

/**
 * Open, and not an older copy of a vacancy that is listed again: employers often post the same
 * vacancy twice (same title, organization, place and closing date; sameVacancyKey in
 * src/components/job-card.tsx). Only the newest copy is listed and counted, so "1–20 of 661" and
 * the cards on the pages always agree. An older copy keeps its own page (links and saved jobs work).
 */
const isListed = () => sql`${isOpen()} and not exists (
  select 1 from jobs d
  where d.id <> j.id and d.status = 'active' and (d.deadline is null or d.deadline >= (now() at time zone 'utc')::date)
    and lower(btrim(d.title)) = lower(btrim(j.title))
    and d.organization_id is not distinct from j.organization_id
    and d.country_code is not distinct from j.country_code
    and lower(coalesce(d.city, d.location_text, '')) = lower(coalesce(j.city, j.location_text, ''))
    and d.deadline is not distinct from j.deadline
    and d.is_demo = j.is_demo
    and (coalesce(d.published_at, d.first_seen_at), d.id) > (coalesce(j.published_at, j.first_seen_at), j.id))`;

/** Apply what the search words mean ("un", "remote", "internship", a country) as filters. */
export function withSearchIntent(f: JobFilters): JobFilters {
  if (!f.q) return f;
  const i = interpretQuery(f.q);
  const words = queryWords(f.q);
  // Only for the filters these words set (a filter chosen in the form is exact).
  const fromWords: QueryWords["from"] = {
    grade: !f.grade?.length && i.grade ? words.from.grade : undefined,
    type: !f.type?.length && i.type ? words.from.type : undefined,
    country: !f.country?.length && !f.region?.length && i.country ? words.from.country : undefined,
    region: !f.country?.length && !f.region?.length && !i.country && i.region ? words.from.region : undefined,
    lang: !f.lang?.length && i.lang ? i.lang : undefined,
  };
  return {
    ...f,
    fromWords: f.fromWords ?? fromWords,
    exact: f.exact ?? (words.exact.length ? words.exact : undefined),
    q: i.text ?? undefined,
    orgtype: f.orgtype?.length ? f.orgtype : i.orgtype ? [i.orgtype] : undefined,
    remote: f.remote || i.remote || undefined,
    type: f.type?.length ? f.type : i.type ? [i.type] : undefined,
    grade: f.grade?.length ? f.grade : i.grade ? [i.grade] : undefined,
    lang: f.lang?.length ? f.lang : i.lang ? [i.lang] : undefined,
    exp: f.exp?.length ? f.exp : i.exp ? [i.exp] : undefined,
    country: f.country?.length ? f.country : f.region?.length || !i.country ? undefined : [i.country],
    // A region read from the words ("africa"), unless a place is already chosen in the filter.
    region: f.region?.length ? f.region : f.country?.length || !i.region ? undefined : [i.region],
    sort: !i.text && f.sort === "relevance" ? undefined : f.sort,
  };
}

const listColumns = () => sql`
  j.id::int as id, j.slug, j.title, o.name as org_name, o.slug as org_slug, o.short_name as org_short,
  case when o.logo is not null and not ${logoProtectedSql("o")} then o.slug end as org_logo,
  j.country_code, j.city, j.location_text, j.is_remote, j.category, j.job_type, j.grade,
  j.published_at, j.first_seen_at, j.deadline::text as deadline, j.status, j.is_demo, j.apply_url,
  j.min_experience_years, j.languages, o.org_type`;

/** The location text normalized exactly like normalizePlace() in src/lib/country-match.ts. */
const FOLD_FROM_SQL = [...FOLD_FROM].join("") + [...FOLD_FROM].map((c) => c.toUpperCase()).join("") + DROP_CHARS;
const FOLD_TO_SQL = FOLD_TO + FOLD_TO;
const placeText = () =>
  sql`(' ' || regexp_replace(translate(lower(coalesce(j.location_text, '')), ${FOLD_FROM_SQL}, ${FOLD_TO_SQL}), '[^a-z0-9]+', ' ', 'g') || ' ')`;

/** The title normalized like placeText, for country names in titles. */
const titlePlaceText = () =>
  sql`(' ' || regexp_replace(translate(lower(coalesce(j.title, '')), ${FOLD_FROM_SQL}, ${FOLD_TO_SQL}), '[^a-z0-9]+', ' ', 'g') || ' ')`;

/** The title names one of these countries (longer names of other countries taken out first, as for the location). */
function titleNamesCountries(codes: string[]): Frag | null {
  const p = locationPatterns(codes);
  return p ? sql`regexp_replace(${titlePlaceText()}, ${p.strip}, ' ', 'g') ~ ${p.match}` : null;
}

/**
 * Jobs in any of these countries: the listing's country, or a country its
 * location text names (a listing for "Nairobi, Kenya; Kampala, Uganda" is in both).
 */
export function placeCondition(codes: string[]): Frag {
  const p = locationPatterns(codes);
  if (!p) return sql`j.country_code = any(${codes})`;
  return sql`(j.country_code = any(${codes}) or regexp_replace(${placeText()}, ${p.strip}, ' ', 'g') ~ ${p.match})`;
}

/**
 * Filters read from the text of a posting (grade, experience, languages, contract type). A posting
 * that doesn't state the detail can't match them, so they leave such listings out unless
 * `unstated` is set.
 */
export const DERIVED_FILTERS = ["grade", "exp", "lang", "type"] as const;
export type DerivedFilter = (typeof DERIVED_FILTERS)[number];

/** The derived filters in use, including those read from the search words ("p3", "internship", "french"). */
export function derivedFilters(f: JobFilters): DerivedFilter[] {
  const read = withSearchIntent(f);
  return DERIVED_FILTERS.filter((k) => Boolean(read[k]?.length));
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
  // One word that found nothing finds nothing: a vacancy without the word isn't shown.
  return words.length > 1;
}

/**
 * One search term matches a listing when it appears as a word (not inside another word: "un" never
 * matches "fund") in the title, the organization's name or short name, or the category name, when
 * it is another name of the organization ("msf", "doctors without borders"), or when it is in the
 * indexed text (title, location, grade, type, summary). Accents don't matter on either side:
 * both are folded (pb_fold in db/migrations/007, foldText in src/lib/search-intent.ts).
 */
function wordCondition(t: string): Frag {
  const folded = foldText(t);
  // An abbreviation for a field of work ("M&E", "HR", "IT"): its category, or the abbreviation in the
  // title or the organization's name. Never the running text, where "it" and "hr" are ordinary words.
  const abbr = ABBREVIATIONS[folded];
  if (abbr) return sql`(j.category = any(${abbr.categories}) or pb_fold(j.title) ~ ${abbr.title} or pb_fold(o.short_name) ~ ${abbr.title})`;
  const p = wordPattern(folded);
  let c = sql`(pb_fold(j.title) ~ ${p} or pb_fold(o.name) ~ ${p} or pb_fold(o.short_name) ~ ${p}`;
  const orgNames = orgNamesForTerm(t);
  if (orgNames.length) c = sql`${c} or pb_fold(o.name) = any(${orgNames}) or pb_fold(o.short_name) = any(${orgNames})`;
  const cats = categoriesForWord(t);
  // A field of work named by the word counts only when the vacancy's text also has the word: a result always holds it.
  if (cats.length) c = sql`${c} or (j.category = any(${cats}) and j.search_full @@ plainto_tsquery('simple', ${folded}))`;
  const plain = /^[a-z0-9]+$/.test(folded);
  if (orgNames.length && folded.includes(" ")) {
    // An organization's name of several words ("save the children"): the organization or the title,
    // not every text that happens to hold those words.
  } else if (plain && folded.length <= SHORT_WORD_MAX) {
    // Short words ("who", "it", "us") are ordinary words in running text: only the title, place, grade and contract type count.
    c = sql`${c} or j.search_folded @@ to_tsquery('simple', ${`${folded}:AB`})`;
  } else if (/[\p{L}\p{N}]/u.test(t)) {
    c = sql`${c} or j.search_folded @@ plainto_tsquery('simple', ${folded})`;
    // A plural also finds the singular in the text ("engineers" → "engineer…").
    const one = singular(folded);
    if (plain && one !== folded) c = sql`${c} or j.search_folded @@ to_tsquery('simple', ${`${one} | ${folded}`})`;
  }
  // The vacancy's full text (the employer's page, or the feed's description: migration 028), for
  // words that are rare in vacancy texts: skills, tools, languages ("russian", "stata", "gis").
  // A word found in more than FULL_TEXT_MAX_SHARE of open vacancies ("health", "who") is too common
  // there to mean the vacancy is about it.
  if (plain && folded.length >= 3) {
    c = sql`${c} or (j.search_full @@ plainto_tsquery('simple', ${folded})
      and (select count(*) from jobs x where x.status = 'active' and x.search_full @@ plainto_tsquery('simple', ${folded}))
          <= ${FULL_TEXT_MAX_SHARE}::float8 * (select count(*) from jobs x where x.status = 'active'))`;
  }
  const places = placeTsQuery([t]);
  if (places) c = sql`${c} or j.search_folded @@ to_tsquery('simple', ${places})`;
  return sql`${c})`;
}

/** See wordCondition: the share of open vacancies above which a word is too common to be looked for in their full text. */
const FULL_TEXT_MAX_SHARE = 0.2;

/** Words up to this long match the title, place, grade and contract type only, never the running text. */
const SHORT_WORD_MAX = 4;

/** A phrase as a Postgres regex for folded text: its words in that order, as whole words ("finance officer" → "\mfinance[^a-z0-9]+officer\M"). */
function phrasePattern(phrase: string): string {
  const words = foldText(phrase).split(/[^a-z0-9&]+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `\\m${words.join("[^a-z0-9]+")}\\M`;
}

/**
 * How well the TITLE answers the search, for the "Best match" order: 3 when the search names the
 * organization, 2 when the title is exactly the search, 1 when the title holds the search's words
 * as a phrase (or its one word), 0 otherwise. Without this a vacancy titled exactly "Finance
 * Officer" could rank below ones that only mention the words.
 */
function titleBoost(q: string): Frag {
  const folded = foldText(q).trim();
  const orgNames = orgNamesForTerm(q);
  const org = orgNames.length ? sql`when pb_fold(o.name) = any(${orgNames}) or pb_fold(o.short_name) = any(${orgNames}) then 3` : sql``;
  if (!/[a-z0-9]/.test(folded)) return sql`0`;
  return sql`(case ${org} when pb_fold(j.title) = ${folded} then 2 when pb_fold(j.title) ~ ${phrasePattern(folded)} then 1 else 0 end)`;
}

/** How many of the search's words the title holds: a title naming the job ranks above a text that only mentions it. */
function titleWordHits(q: string): Frag {
  const terms = [...new Set(searchWords(interpretQuery(q).text ?? q).map(foldText).filter((t) => /[a-z0-9]/.test(t)))].slice(0, 8);
  if (!terms.length) return sql`0`;
  return terms.map((t) => sql`(case when pb_fold(j.title) ~ ${wordPattern(t)} then 1 else 0 end)`).reduce((a, b) => sql`${a} + ${b}`);
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
  const stem = loosePrefix(t);
  // Similar words only in the TITLE: in running text a word start ("unit" in "United") finds unrelated vacancies.
  const prefix = stem && stem !== folded ? sql` or pb_fold(j.title) ~ ${`\\m${stem}`}` : sql``;
  return sql`(${wordCondition(t)}${prefix} or pb_word_similarity(${folded}, pb_fold(j.title)) >= ${TYPO_TITLE_SIMILARITY})`;
}

/**
 * The start of a word that the loose fallback also matches, for words of TYPO_MIN_LENGTH letters
 * or more: the word without a common ending ("finance" → "financ", so it finds "Financing" and
 * "Financial"; "monitoring" → "monitor"). Null for shorter words and anything but plain letters
 * and digits (the prefix goes into a tsquery).
 */
export function loosePrefix(t: string): string | null {
  const f = foldText(t);
  if (f.length < TYPO_MIN_LENGTH || !/^[a-z0-9]+$/.test(f)) return null;
  const stem = f.replace(/(?:ing|es|ed|e|s)$/, "");
  return stem.length >= 4 ? stem : f;
}

/** The term in the TITLE, for the loose fallback's order: as a word, the start of one (loosePrefix) or spelled almost the same way. */
function titleWordCondition(t: string): Frag {
  const folded = foldText(t);
  let c = sql`pb_fold(j.title) ~ ${wordPattern(folded)}`;
  const stem = loosePrefix(t);
  if (stem) c = sql`${c} or pb_fold(j.title) ~ ${`\\m${stem}`} or pb_word_similarity(${folded}, pb_fold(j.title)) >= ${TYPO_TITLE_SIMILARITY}`;
  return sql`(${c})`;
}

/**
 * How much each search word counts in the loose fallback's order: words in the titles of fewer open
 * listings count more (inverse document frequency over titles, ln((N + 1) / (n + 1)) plus a little,
 * so a word in every title still counts). "finance officer" then puts finance jobs before the many
 * "… Officer" ones. One query over the open listings.
 */
async function looseWordWeights(terms: string[]): Promise<number[]> {
  if (!terms.length) return [];
  const counts = terms.map((t) => sql`(count(*) filter (where ${titleWordCondition(t)}))::int`).reduce((a, b) => sql`${a}, ${b}`);
  const [row] = await transaction(async (tx) => await tx<{ n: number; df: number[] }[]>`
    select count(*)::int as n, array[${counts}] as df from jobs j left join organizations o on o.id = j.organization_id where ${isOpen()}`);
  return row.df.map((df) => Math.log((row.n + 1) / (df + 1)) + 0.05);
}

/**
 * The loose fallback's "Best match" order: each word that matches adds its weight (looseWordWeights),
 * three times over when it is in the title.
 */
function looseRank(terms: string[], weights: number[]): Frag {
  return terms
    .map((t, i) => sql`((${titleWordCondition(t)})::int * 2 + (${looseWordCondition(t)})::int) * ${weights[i] ?? 1}::float8`)
    .reduce((a, b) => sql`${a} + ${b}`);
}

function textCondition(q: string, mode: MatchMode): Frag {
  if (mode === "any") {
    // Any of the words, each where it really appears: no similar spellings, so every result holds a search word.
    const loose = searchWords(q).map(wordCondition);
    return loose.length ? sql`(${loose.reduce((a, b) => sql`${a} or ${b}`)})` : sql`true`;
  }
  const parts = searchWords(q).map(wordCondition);
  if (!parts.length) return sql`true`;
  // Every term must match (wordCondition); each one decides for itself where it may match, so a
  // short word or an abbreviation is never found in running text through the back door.
  return sql`(${parts.reduce((a, b) => sql`${a} and ${b}`)})`;
}

/**
 * The grade, or for a listing without one the grade group its title names (titleGradeGroup in
 * src/lib/grades.ts): "NO" for National Officer titles, "P" / "G" for IOM's "(P)" / "(G)" suffixes.
 * Used for the grade counts, so such a listing counts once, under its group.
 */
const gradeKey = () => sql`coalesce(j.grade, case
  when lower(j.title) ~ ${NATIONAL_OFFICER_TITLE_SQL} or j.title ~ ${NO_LEVEL_CAPS_SQL} then 'NO'
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

/**
 * A listing that doesn't state the detail a derived filter reads: no grade (nor a grade group in
 * its title, see gradeKey), no years of experience, no language besides English (required or
 * desirable), no contract type.
 */
const UNSTATED: Record<DerivedFilter, () => Frag> = {
  grade: () => sql`${gradeKey()} is null`,
  exp: () => sql`j.min_experience_years is null`,
  lang: () => sql`(coalesce(cardinality(j.languages), 0) = 0 and coalesce(cardinality(j.desirable_languages), 0) = 0)`,
  type: () => sql`j.job_type is null`,
};

/** A location that says the post is remote or home-based (Postgres regex for the lower-cased location and city). */
const REMOTE_PLACE_SQL = "\\m(remote|home[- ]?based|work(ing)? from home|telework(ing)?|telecommut(e|ing)|teletravail|télétravail|teletrabajo)\\M";

/** The SQL condition for each filter that is set, keyed by filter. */
function filterConditions(f: JobFilters, mode: MatchMode = "all"): Partial<Record<FilterKey, Frag>> {
  const c: Partial<Record<FilterKey, Frag>> = {};
  if (f.q) c.q = textCondition(f.q, mode);
  // Phrases in double quotes: the title holds the phrase, or the indexed text has its words in that order.
  if (c.q && f.exact?.length && mode === "all") {
    const phrases = f.exact.map((ph): Frag => sql`(pb_fold(j.title) ~ ${phrasePattern(ph)} or j.search_folded @@ phraseto_tsquery('simple', ${ph}))`).reduce((a, b) => sql`${a} and ${b}`);
    c.q = sql`(${c.q} and ${phrases})`;
  }
  // A filter read from the search words also matches a vacancy whose TITLE carries the word
  // ("kosovo" → "EULEX Kosovo…", "p3" → "Logistics Officer P3", "volunteer" → UN Volunteers posts).
  const titleHas = (pattern: string | null | undefined): Frag | null => (pattern ? sql`pb_fold(j.title) ~ ${pattern}` : null);
  const orTitle = (cond: Frag, extra: Frag | null) => (extra ? sql`(${cond} or ${extra})` : cond);
  if (f.org?.length) c.org = sql`o.slug = any(${f.org})`;
  if (f.country?.length || f.region?.length) {
    // Any of the chosen countries and regions (one "where" filter).
    const codes = [
      ...(f.country ?? []).flatMap((s) => countryBySlug(s)?.code ?? []),
      ...(f.region ?? []).flatMap((s) => regionBySlug(s)?.codes ?? []),
    ];
    // A country read from the words also matches a title naming it, with the same rule as the
    // location ("South Sudan" is not Sudan, "Papua New Guinea" is not Guinea).
    const titlePlace = f.fromWords?.country ? titleNamesCountries(codes) : f.fromWords?.region ? titleHas(phrasePattern(f.fromWords.region)) : null;
    c.where = orTitle(codes.length ? placeCondition([...new Set(codes)]) : sql`false`, titlePlace);
  }
  // With `unstated`, each derived filter also matches listings that don't state the detail (UNSTATED).
  const orUnstated = (k: DerivedFilter, cond: Frag) => (f.unstated ? sql`(${cond} or ${UNSTATED[k]()})` : cond);
  if (f.grade?.length) c.grade = orUnstated("grade", orTitle(sql`(${f.grade.map(gradeCondition).reduce((a, b) => sql`${a} or ${b}`)})`, titleHas(f.fromWords?.grade ? gradeTitlePattern(f.fromWords.grade) : null)));
  if (f.orgtype?.length) c.orgtype = sql`o.org_type = any(${f.orgtype.map((v) => ORG_TYPES.find((o) => o.value === v)?.type ?? "--")})`;
  // A language read from the words ("russian") also matches a vacancy whose full text names it.
  const langInText = f.fromWords?.lang ? sql`j.search_full @@ plainto_tsquery('simple', ${foldText(f.fromWords.lang)})` : null;
  if (f.lang?.length) c.lang = orUnstated("lang", orTitle(sql`j.languages && ${f.lang}::text[]`, langInText));
  if (f.exp?.length) {
    const bands = f.exp.flatMap((v) => EXPERIENCE_BANDS.find((b) => b.value === v) ?? []);
    const any = bands.map((b): Frag => sql`j.min_experience_years between ${b.min} and ${b.max}`).reduce((a, b) => sql`${a} or ${b}`, sql`false`);
    c.exp = orUnstated("exp", sql`(${any})`);
  }
  if (f.category?.length) c.category = sql`j.category = any(${f.category})`;
  // The flag set at import, or a location that says so ("Home Based", "Remote", "Telework").
  if (f.remote) c.remote = sql`(j.is_remote is true or lower(coalesce(j.location_text, '') || ' ' || coalesce(j.city, '')) ~ ${REMOTE_PLACE_SQL})`;
  if (f.type?.length) {
    // The contract word as a whole word ("intern", "interns", "internship"), never the start of
    // another word ("International").
    const stem = f.fromWords?.type ? foldText(f.fromWords.type).replace(/(ships?|s)$/, "") : null;
    const typeWord = stem ? `\\m${stem}(s|ship|ships)?\\M` : null;
    c.type = orUnstated("type", orTitle(sql`j.job_type = any(${f.type})`, typeWord ? sql`(pb_fold(j.title) ~ ${typeWord} or pb_fold(o.name) ~ ${typeWord})` : null));
  }
  if (f.posted) c.posted = sql`coalesce(j.published_at, j.first_seen_at) >= now() - make_interval(days => ${Number(f.posted)})`;
  if (f.closing) c.closing = sql`j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + ${Number(f.closing)}::int`;
  // Same rule as isLocalOnly() in src/lib/grades.ts: the parsed grade, or words in the title.
  if (f.hidelocal) c.hidelocal = sql`(coalesce(j.grade, '') !~ ${LOCAL_ONLY_GRADE_SQL} and lower(j.title) !~ ${LOCAL_ONLY_TITLE_SQL} and j.title !~ ${NO_LEVEL_CAPS_SQL})`;
  return c;
}

/** Open listings plus the alert-only limits (never set from the URL). */
function baseCondition(f: JobFilters): Frag {
  let w = isListed();
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
    const terms = f.q ? searchWords(f.q) : [];
    const looseOrder = sort === "relevance" && mode === "any" && terms.length > 0;
    const weights = looseOrder ? await looseWordWeights(terms) : [];
    const order =
      sort === "deadline" ? sql`j.deadline asc nulls last, coalesce(j.published_at, j.first_seen_at) desc, j.id desc` :
      looseOrder && f.q
        ? sql`(${looseRank(terms, weights)}) desc, ts_rank(j.search_folded, ${rankQuery(f.q)}) desc, coalesce(j.published_at, j.first_seen_at) desc, j.id desc` :
      sort === "relevance" && f.q ? sql`${titleBoost(f.q)} desc, ${titleWordHits(f.q)} desc, ts_rank(j.search_folded, ${rankQuery(f.q)}) desc, coalesce(j.published_at, j.first_seen_at) desc, j.id desc` :
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
 * How many listings these filters match, with the match mode the results used (see searchJobs).
 * For "{N} more don't state one": the same filters with `unstated`, less the results shown.
 */
export async function countJobs(input: JobFilters, mode: MatchMode = "all"): Promise<number> {
  const where = whereFor(withSearchIntent(input), mode);
  const [r] = await transaction(async (tx) => await tx<{ n: number }[]>`select count(*)::int as n from jobs j left join organizations o on o.id = j.organization_id where ${where}`);
  return r.n;
}

/** How many of a search's results have a published closing date (for "8 of these 36 have a closing date"). */
export async function countDated(input: JobFilters, mode: MatchMode = "all"): Promise<number> {
  const where = whereFor(withSearchIntent(input), mode);
  const [r] = await transaction(async (tx) => await tx<{ n: number }[]>`select count(*)::int as n from jobs j left join organizations o on o.id = j.organization_id where ${where} and j.deadline is not null`);
  return r.n;
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
    where ${isListed()} and not j.is_demo
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
 * pg_trgm's trigrams of one word of letters and digits: the word padded with two spaces in front
 * and one behind, every run of three characters, each once. Pure, so it is unit-tested.
 */
export function wordTrigrams(word: string): Set<string> {
  const padded = `  ${word.toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * pg_trgm's similarity() of two trigram sets: shared trigrams over all distinct trigrams (0 to 1).
 * For words of letters and digits it is exactly what the database computes. Pure, so it is unit-tested.
 */
export function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** The words "Did you mean …?" corrects towards, with their trigrams. */
type Vocabulary = { words: Set<string>; trigrams: { word: string; grams: Set<string> }[] };

/** How long one server instance keeps the vocabulary before reading it again (new listings add words). */
export const SUGGESTION_VOCABULARY_TTL_MS = 10 * 60_000;
let vocabulary: { at: number; value: Promise<Vocabulary> } | null = null;

/**
 * The words of every open listing's title plus the category vocabulary (TYPO_MIN_LENGTH - 1 letters
 * or more), read with ONE query and kept in memory for SUGGESTION_VOCABULARY_TTL_MS per server
 * instance, so a search that finds nothing costs no scan of the open listings. Calls at the same
 * moment share one read; a failed read isn't kept.
 */
function suggestionVocabulary(now = Date.now()): Promise<Vocabulary> {
  if (vocabulary && now - vocabulary.at < SUGGESTION_VOCABULARY_TTL_MS) return vocabulary.value;
  const value = (async () => {
    const rows = await transaction(async (tx) => await tx<{ w: string }[]>`
      select distinct w from (
        select regexp_split_to_table(pb_fold(j.title), '[^a-z0-9]+') as w from jobs j where ${isOpen()}
      ) x where length(w) >= ${TYPO_MIN_LENGTH - 1}`);
    const words = new Set([...rows.map((r) => r.w), ...CATEGORY_VOCABULARY.filter((w) => w.length >= TYPO_MIN_LENGTH - 1)]);
    return { words, trigrams: [...words].map((word) => ({ word, grams: wordTrigrams(word) })) };
  })();
  const entry = { at: now, value };
  vocabulary = entry;
  value.catch(() => { if (vocabulary === entry) vocabulary = null; });
  return value;
}

/** Forgets the cached vocabulary (tests, after changing the listings). */
export function resetSuggestionVocabulary(): void {
  vocabulary = null;
}

/**
 * "Did you mean …?" for a search that matched nothing exactly: each word of the search (of
 * TYPO_MIN_LENGTH letters or more) that is not a word of any open listing's title or of the
 * category vocabulary is replaced by the closest such word (pg_trgm's similarity, computed here
 * over the cached vocabulary; ties go to the alphabetically first word). Returns the corrected
 * search, or null when nothing close was found.
 */
/** Does any open vacancy's title or text hold this word? */
async function anyJobHas(term: string): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from (select 1 from jobs j where ${isListed()} and j.search_full @@ plainto_tsquery('simple', ${term}) limit 1) x`;
  return r.n > 0;
}

/**
 * Spanish and French words for fields of work, with the English words vacancies use (folded, no
 * accents). Only for "Did you mean": a search never matches a vacancy that doesn't hold its word.
 */
const TRANSLATIONS: Record<string, string[]> = {
  agua: ["water", "wash"], saneamiento: ["sanitation", "wash"], higiene: ["hygiene", "wash"], eau: ["water", "wash"], assainissement: ["sanitation", "wash"],
  ingeniero: ["engineer"], ingeniera: ["engineer"], ingenieur: ["engineer"], ingenieria: ["engineering"],
  salud: ["health"], sante: ["health"], medico: ["doctor", "medical"], medecin: ["doctor", "medical"], enfermera: ["nurse"], enfermero: ["nurse"], infirmier: ["nurse"],
  finanzas: ["finance"], contable: ["accountant", "finance"], comptable: ["accountant", "finance"], contabilidad: ["accounting"], comptabilite: ["accounting"],
  educacion: ["education"], education: ["education"], proteccion: ["protection"], protection: ["protection"],
  logistica: ["logistics"], logistique: ["logistics"], adquisiciones: ["procurement"], compras: ["procurement"], achats: ["procurement"],
  comunicacion: ["communications", "communication"], communication: ["communications"], recursos: ["resources"], humanos: ["human"],
  pasante: ["intern", "internship"], pasantia: ["internship"], practicas: ["internship"], stagiaire: ["intern"], stage: ["internship"],
  consultor: ["consultant"], consultora: ["consultant"], consultoria: ["consultancy"],
  seguridad: ["security"], securite: ["security"], alimentaria: ["food"], nutricion: ["nutrition"], genero: ["gender"], genre: ["gender"],
  migracion: ["migration"], refugiados: ["refugee", "refugees"], refugies: ["refugee", "refugees"], derechos: ["rights"], droits: ["rights"],
  monitoreo: ["monitoring"], evaluacion: ["evaluation"], suivi: ["monitoring"], evaluation: ["evaluation"],
  datos: ["data"], donnees: ["data"], informatica: ["it"], clima: ["climate"], climat: ["climate"], medio: ["environment"], ambiente: ["environment"], environnement: ["environment"],
  asistente: ["assistant"], coordinador: ["coordinator"], coordinadora: ["coordinator"], coordonnateur: ["coordinator"], especialista: ["specialist"], specialiste: ["specialist"],
  oficial: ["officer"], responsable: ["manager", "officer"], gerente: ["manager"], director: ["director"], directeur: ["director"],
};

export async function searchSuggestion(q: string | undefined): Promise<{ q: string; words: string[] } | null> {
  const text = q ? interpretQuery(q).text : null;
  if (!q || !text) return null;
  const terms = [...new Set(searchWords(text).map(foldText).filter((t) => t.length >= TYPO_MIN_LENGTH && /^[a-z0-9]+$/.test(t)))];
  if (!terms.length) return null;
  const vocab = await suggestionVocabulary();
  let out = q;
  const words: string[] = [];
  for (const term of terms) {
    // A place's name is never "corrected" ("geneva" is not a typo of "genes").
    if (placeVariants(term).length) continue;
    // A Spanish or French word with no vacancy holding it: the English word the vacancies use ("saneamiento" → "sanitation").
    // Checked before the known words, which hold the category vocabulary in several languages.
    const english = TRANSLATIONS[term] && !(await anyJobHas(term)) ? TRANSLATIONS[term].find((w) => vocab.words.has(w)) : undefined;
    if (!english && vocab.words.has(term)) continue;
    const grams = wordTrigrams(term);
    let best: string | null = english ?? null;
    let bestScore = 0;
    for (const v of english ? [] : vocab.trigrams) {
      const score = trigramSimilarity(grams, v.grams);
      if (score < TYPO_SUGGEST_SIMILARITY) continue;
      if (score > bestScore || (score === bestScore && best !== null && v.word < best)) {
        best = v.word;
        bestScore = score;
      }
    }
    if (!best || best === term) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "giu");
    const next = out.replace(re, `$1${best}`);
    if (next !== out) {
      out = next;
      words.push(best);
    }
  }
  return words.length ? { q: out, words } : null;
}

/**
 * The newest open listings ("Recently posted" on the home page, the alert example, the fallback
 * under empty results), picked and returned purely newest first (posting date, or first seen when
 * the source gives none), so a list headed "Recently posted" is literally that.
 */
export async function latestJobs(limit = 8) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isListed()}
    order by coalesce(j.published_at, j.first_seen_at) desc, j.id desc
    limit ${limit}`;
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
      where ${isListed()} and not j.is_demo and coalesce(j.published_at, j.first_seen_at) >= now() - make_interval(days => 7)
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
    where ${isListed()} and j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + 14
    order by j.deadline asc, coalesce(j.published_at, j.first_seen_at) desc, j.id desc limit ${limit}`;
}

export async function getJob(id: number): Promise<JobDetail | null> {
  const rows = await sql<JobDetail[]>`
    select ${listColumns()}, j.desirable_languages, j.summary, j.description_html, j.content_policy, j.apply_host, j.reference,
           j.updated_at, j.last_seen_at
    from jobs j left join organizations o on o.id = j.organization_id
    where j.id = ${id}`;
  const job = rows[0];
  if (!job) return null;
  // Listings imported before a job board's words were removed at import (src/lib/board-text.ts).
  if (job.description_html) job.description_html = stripBoardText(job.description_html) || null;
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

/** Open listings at the same organization or in the same category, the organization's first (the closed-vacancy page). */
export async function similarJobs(job: JobDetail, limit = 4) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isListed()} and j.id <> ${job.id} and (j.category = ${job.category} or o.slug = ${job.org_slug ?? "--"})
    order by (o.slug = ${job.org_slug ?? "--"}) desc nulls last, coalesce(j.published_at, j.first_seen_at) desc, j.id desc limit ${limit}`;
}

/**
 * "More in {category}" on a job page: other open listings in the same category at OTHER
 * organizations (the page links to the organization's own other vacancies instead), those in the
 * same grade group (gradeGroupOf: "P", "EU AD"…) first, then those in the same world region, then
 * the newest. None for the catch-all "Other" category.
 */
export async function moreInCategory(job: Pick<JobDetail, "id" | "category" | "org_slug" | "grade" | "title" | "country_code">, limit = 4) {
  if (job.category === "other") return [];
  const group = gradeGroupOf(job.grade ?? titleGradeGroup(job.title) ?? "");
  const groupGrades = group ? [...(GRADE_GROUPS.find((g) => g.value === group)?.grades ?? []), group] : [];
  const sameGroup = group === "SC" ? sql`coalesce(j.grade, '') ~ '^(SB|SC|LICA|NPSA|IPSA|ICS)-'` : groupGrades.length ? sql`${gradeKey()} = any(${groupGrades})` : sql`false`;
  const region = regionOf(job.country_code)?.codes ?? [];
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isListed()} and j.id <> ${job.id} and j.category = ${job.category} and o.slug is distinct from ${job.org_slug ?? null}
    order by (${sameGroup}) desc, (j.country_code = any(${region})) desc nulls last, coalesce(j.published_at, j.first_seen_at) desc, j.id desc
    limit ${limit}`;
}

// ── Facets & stats ───────────────────────────────────────────

export async function organizationFacets(limit = 500, includeDemo = true) {
  return sql<{ slug: string; name: string; short_name: string | null; org_type: string | null; logo: string | null; count: number }[]>`
    select o.slug, o.name, o.short_name, o.org_type, case when o.logo is not null and not ${logoProtectedSql("o")} then o.slug end as logo, count(*)::int as count
    from jobs j join organizations o on o.id = j.organization_id
    where ${isListed()} and (${includeDemo} or not j.is_demo) group by o.id order by count(*) desc, o.name limit ${limit}`;
}

/**
 * Every organization that has had a listing (for the alert sign-up's picker: an alert is about
 * vacancies still to come, so one with nothing open today can be followed too). Open counts first.
 */
export async function alertOrganizations() {
  return sql<{ slug: string; name: string; count: number }[]>`
    select o.slug, o.name, count(j.id) filter (where ${isListed()} and not j.is_demo)::int as count
    from organizations o join jobs j on j.organization_id = o.id
    where not j.is_demo
    group by o.id order by 3 desc, o.name limit 1500`;
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
      where ${isListed()} and (${includeDemo} or not j.is_demo)
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
                'remote', (count(*) filter (where is_remote or lower(coalesce(location_text, '')) ~ ${REMOTE_PLACE_SQL}))::int,
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

/**
 * Open listings by employer type (ORG_TYPES type names → count), for the header and footer menus,
 * which leave out a type with none. One small query, shared by everything in one render (cache).
 */
export const employerTypeCounts = cache(async (): Promise<Map<string, number>> => {
  const rows = await sql<{ k: string; n: number }[]>`
    select o.org_type as k, count(*)::int as n from jobs j join organizations o on o.id = j.organization_id
    where ${isListed()} and o.org_type is not null group by 1`;
  return new Map(rows.map((r) => [r.k, r.n]));
});

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
/**
 * Every organization, country, language, grade and contract type any listing has ever had (open
 * or not), so a filter keeps offering a choice after its last vacancy closes (shown with 0).
 * Read at most once an hour.
 */
type EverSeen = { orgs: { slug: string; name: string }[]; countries: string[]; languages: string[]; grades: string[]; types: string[] };
let everSeenCache: { at: number; value: EverSeen } | null = null;
async function everSeen(): Promise<EverSeen> {
  if (everSeenCache && Date.now() - everSeenCache.at < 3_600_000) return everSeenCache.value;
  const [r] = await transaction(async (tx) => await tx<EverSeen[]>`
    select
      (select coalesce(json_agg(json_build_object('slug', o.slug, 'name', o.name) order by o.name), '[]'::json)
         from organizations o where exists (select 1 from jobs j where j.organization_id = o.id and not j.is_demo)) as orgs,
      (select coalesce(array_agg(distinct country_code), '{}') from jobs where country_code is not null and not is_demo) as countries,
      (select coalesce(array_agg(distinct l), '{}') from jobs, unnest(languages) l where not is_demo) as languages,
      (select coalesce(array_agg(distinct grade), '{}') from jobs where grade is not null and not is_demo) as grades,
      (select coalesce(array_agg(distinct job_type), '{}') from jobs where job_type is not null and not is_demo) as types`);
  everSeenCache = { at: Date.now(), value: r };
  return r;
}

/** Adds the choices that once had vacancies but have none for this search, with a count of 0, after the others. */
function withEverSeen(f: FilteredFacets, e: EverSeen): FilteredFacets {
  const has = <T,>(list: T[], key: (x: T) => string) => new Set(list.map(key));
  const orgSet = has(f.orgs, (o) => o.slug);
  const countrySet = has(f.countries, (c) => c.code);
  const langSet = has(f.langs, (l) => l.lang);
  const gradeSet = has(f.grades, (g) => g.grade);
  const typeSet = has(f.types, (t) => t.job_type);
  return {
    ...f,
    orgs: [...f.orgs, ...e.orgs.filter((o) => !orgSet.has(o.slug)).map((o) => ({ ...o, count: 0 }))],
    countries: [...f.countries, ...e.countries.filter((c) => !countrySet.has(c)).flatMap((code) => {
      const c = countryByCode(code);
      return c ? [{ code, slug: c.slug, name: c.name, count: 0 }] : [];
    }).sort((a, b) => a.name.localeCompare(b.name))],
    langs: [...f.langs, ...e.languages.filter((l) => !langSet.has(l)).sort().map((lang) => ({ lang, count: 0 }))],
    grades: [...f.grades, ...e.grades.filter((g) => !gradeSet.has(g)).map((grade) => ({ grade, count: 0 }))],
    types: [...f.types, ...e.types.filter((t) => !typeSet.has(t)).map((job_type) => ({ job_type, count: 0 }))],
  };
}

export async function filteredFacets(input: JobFilters, mode: MatchMode = "all"): Promise<FilteredFacets> {
  const [f, e] = await Promise.all([filteredFacetsNow(input, mode), everSeen().catch(() => null)]);
  return e ? withEverSeen(f, e) : f;
}

async function filteredFacetsNow(input: JobFilters, mode: MatchMode = "all"): Promise<FilteredFacets> {
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
    select id, slug, name, short_name, org_type, case when logo is not null and not ${logoProtectedSql("organizations")} then slug end as logo from organizations where slug = ${slug}`;
  return rows[0] ?? null;
}

/** Several organizations by slug (the organization filter's chips and labels), in the order given; unknown slugs are left out. */
export async function getOrganizations(slugs: string[]): Promise<{ slug: string; name: string; short_name: string | null }[]> {
  const list = slugs.filter((s) => typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s)).slice(0, 20);
  if (!list.length) return [];
  const rows = await sql<{ slug: string; name: string; short_name: string | null }[]>`select slug, name, short_name from organizations where slug = any(${list})`;
  return list.flatMap((s) => rows.find((r) => r.slug === s) ?? []);
}

/** How far back "recent" listings go for an organization's posting mix (organizationPostingMix). */
export const POSTING_MIX_DAYS = 180;

/**
 * What an organization's listings usually are, for its page: contract types and grade groups
 * (gradeKey, so IOM's "(P)" counts as Professional) among its open listings and those first seen
 * in the past POSTING_MIX_DAYS days, closed ones included, each with how many state it. Demo
 * listings count only on a site that shows them.
 */
export async function organizationPostingMix(slug: string): Promise<{ total: number; types: Count<string>[]; grades: Count<string>[] }> {
  const [r] = await transaction(async (tx) => await tx<{ total: number; types: Count<string>[]; grades: Count<string>[] }[]>`
    with mine as materialized (
      select j.job_type, ${gradeKey()} as grade
      from jobs j join organizations o on o.id = j.organization_id
      where o.slug = ${slug} and (${isOpen()} or j.first_seen_at >= now() - make_interval(days => ${POSTING_MIX_DAYS}))
    )
    select
      (select count(*)::int from mine) as total,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select job_type as k, count(*)::int as n from mine where job_type is not null group by 1) x) as types,
      (select coalesce(json_agg(json_build_object('k', k, 'n', n) order by n desc, k), '[]'::json)
         from (select grade as k, count(*)::int as n from mine where grade is not null group by 1) x) as grades`);
  return r;
}

export async function hasDemoJobs(): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j where j.is_demo and ${isOpen()}`;
  return r.n > 0;
}
