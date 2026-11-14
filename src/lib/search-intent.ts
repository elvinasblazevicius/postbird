/**
 * Reading what people mean when they type a search: "un jobs in kenya",
 * "remote internship", "eu vacancies". Known words become filters and the
 * rest is matched against titles, organizations and descriptions.
 */
import { CATEGORIES } from "@/config/categories";
import { COUNTRIES } from "@/config/countries";
import { SEARCH_LANGUAGES } from "@/config/regions";
import { KNOWN_ORGS } from "@/config/organizations";

export type SearchIntent = {
  /** Words left to match as text (null when nothing is left). */
  text: string | null;
  orgtype?: string;
  remote?: boolean;
  type?: string;
  country?: string;
  /** A grade written in the search ("p3", "P-3", "NOA", "GS-6"), normalized ("P-3", "NO-A", "GS-6"). */
  grade?: string;
  /** A language the language filter knows ("french" → "French"; see languageFromWord). */
  lang?: string;
  /** "entry level", "junior", "graduate": the experience band "0-2" (EXPERIENCE_BANDS in src/lib/jobs.ts). */
  exp?: string;
  /** A world region the "Where" filter knows ("africa", "latin america" → its slug in REGIONS, src/config/regions.ts). */
  region?: string;
};

/**
 * What else a search's words say, beside the filters of SearchIntent:
 * `from`: the words each filter was read from ("kosovo", "p3", "volunteer"). A vacancy whose TITLE
 * carries the word matches too, even when its parsed field is empty or different: "EULEX Kosovo"
 * has no country field, "Logistics Officer P3" no parsed grade.
 * `exact`: phrases typed in double quotes ("finance officer"), folded: the title or text must hold
 * them in that order.
 */
export type QueryWords = { from: { country?: string; region?: string; grade?: string; type?: string; lang?: string }; exact: string[] };

const STOP_WORDS = new Set([
  "job", "jobs", "vacancy", "vacancies", "position", "positions", "post", "posts", "career", "careers", "opening", "openings",
  "opportunity", "opportunities", "role", "roles", "work", "employment", "hiring", "in", "at", "for", "with", "the", "a", "an", "of", "and",
]);

/** Phrases that pick an organization type. Longest first. */
const ORG_TYPE_PHRASES: [string, string][] = [
  ["united nations", "un"],
  ["un system", "un"],
  ["european union", "eu"],
  ["eu institutions", "eu"],
  ["un", "un"],
  ["eu", "eu"],
  ["ngo", "ngo"],
  ["ngos", "ngo"],
];

const REMOTE_WORDS = new Set(["remote", "home-based", "homebased", "telecommute", "telework"]);
/** Phrases that mean remote work. */
const REMOTE_PHRASES = ["work from home", "working from home", "home based"];
const INTERNSHIP_WORDS = new Set(["intern", "interns", "internship", "internships"]);
const CONSULTANCY_WORDS = new Set(["consultancy", "consultancies", "consultant", "consultants"]);
const VOLUNTEER_WORDS = new Set(["volunteer", "volunteers", "volunteering"]);
const FELLOWSHIP_WORDS = new Set(["fellowship", "fellowships"]);

/**
 * Region words and the "Where" filter's region they pick (slugs of REGIONS in src/config/regions.ts).
 * Longest first, so "central asia" is read before "asia" and "north africa" before "africa".
 * Countries are read first, so "south africa" stays a country. Parts of a region pick the region
 * that holds them ("west africa" → Africa), so no stray word is left to match as text. A pair named
 * in full ("Asia and the Pacific", "MENA") picks the old paired region, which still covers both halves.
 */
const REGION_PHRASES: [string, string][] = ([
  ["latin america and the caribbean", "latin-america-caribbean"],
  ["middle east and north africa", "middle-east-north-africa"],
  ["europe and central asia", "europe-central-asia"],
  ["asia and the pacific", "asia-pacific"],
  ["sub-saharan africa", "africa"],
  ["latin america", "latin-america"],
  ["asia pacific", "asia-pacific"],
  ["asia-pacific", "asia-pacific"],
  ["middle east", "middle-east"],
  ["north africa", "africa"],
  ["west africa", "africa"],
  ["east africa", "africa"],
  ["southern africa", "africa"],
  ["central africa", "africa"],
  ["central asia", "central-asia"],
  ["eastern europe", "europe"],
  ["western europe", "europe"],
  ["southeast asia", "asia"],
  ["south asia", "asia"],
  ["east asia", "asia"],
  ["caribbean", "caribbean"],
  ["mena", "middle-east-north-africa"],
  ["africa", "africa"],
  ["europe", "europe"],
  ["asia", "asia"],
  ["pacific", "pacific"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

/** The region slugs REGION_PHRASES names (a test checks each is a REGIONS slug). */
export const SEARCH_REGION_SLUGS = [...new Set(REGION_PHRASES.map(([, slug]) => slug))];

/** Words for a first job: the experience filter's lowest band. */
const ENTRY_PHRASES = ["entry level", "early career", "entry-level", "early-career"];
const ENTRY_WORDS = new Set(["junior", "graduate", "graduates", "beginner"]);

const COUNTRY_NAMES: [string, string][] = COUNTRIES.flatMap((c) =>
  [c.name, ...c.aliases]
    // Short names are skipped (they could be ordinary words), except capitalised acronyms such as UK, USA, UAE or DRC.
    .filter((n) => n.length >= 4 || /^[A-Z]{2,4}$/.test(n))
    .map((n) => [n.toLowerCase(), c.slug] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

/**
 * Lower case without accents, the same as pb_fold() in the database (db/migrations/007): "Médecins" → "medecins".
 * Letters that unaccent spells out (œ, æ, ß) are spelled out here too.
 */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss").replace(/þ/g, "th")
    .replace(/ø/g, "o").replace(/ł/g, "l").replace(/đ/g, "d").replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** How a search box value is tidied before reading it (lower case, no quotes or punctuation). */
const tidyQuery = (s: string) =>
  s.toLowerCase()
    .replace(/[“”"'’,;:!?()<>[\]{}=*\\]/g, " ")
    // "M & E", "m and e" → "m&e" (one word, see ABBREVIATIONS)
    .replace(/(^|\s)m\s*(?:&|and)\s*e(?=\s|$)/g, "$1m&e")
    .split(/\s+/)
    // Emoji, lone punctuation and the like match nothing useful.
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .join(" ");

/** Phrases typed in double quotes, tidied and folded (at most 3, each of two words or more). */
export function quotedPhrases(q: string | undefined | null): string[] {
  if (!q) return [];
  return [...q.matchAll(/["“]([^"“”]{3,80})["”]/g)]
    .map((m) => foldText(tidyQuery(m[1])))
    .filter((p) => p.includes(" "))
    .slice(0, 3);
}

/**
 * Abbreviations people type for a field of work: the categories they mean, and how the
 * abbreviation is written in titles (a Postgres regex on the folded title). "M&E" finds the
 * Monitoring and evaluation category and titles such as "M&E Officer" or "M & E Specialist".
 */
export const ABBREVIATIONS: Record<string, { categories: string[]; title: string }> = {
  "m&e": { categories: ["monitoring-evaluation"], title: "\\mm ?& ?e\\M|\\mmeal\\M" },
  meal: { categories: ["monitoring-evaluation"], title: "\\mmeal\\M" },
  hr: { categories: ["human-resources"], title: "\\mhr\\M" },
  it: { categories: ["it"], title: "\\mit\\M" },
  ict: { categories: ["it"], title: "\\mict\\M" },
  gbv: { categories: ["gender"], title: "\\m(gbv|vbg)\\M" },
};

/** Words that pick an organization type (see ORG_TYPE_PHRASES); never treated as one organization's alias. */
const ORG_TYPE_WORDS = new Set(["un", "eu", "united nations", "european union", "ngo", "ngos", "un system", "eu institutions"]);

/**
 * Organization aliases a search can use: acronyms (MSF, MdM, ADB, AfDB, EIB, IDB, IOM, UNHCR…) and
 * names of several words ("doctors without borders"), each with every name of that organization,
 * folded, to compare with the stored organization name and short name.
 */
type OrgAlias = { key: string; names: string[] };
const ORG_ALIASES: OrgAlias[] = KNOWN_ORGS.flatMap((o) => {
  const all = [o.name, o.short, ...(o.aliases ?? [])].filter((n): n is string => Boolean(n));
  const names = [...new Set(all.map(foldText))];
  const keys = all.filter((n) => /^[A-Za-z][A-Za-z-]{1,7}$/.test(n) ? (n.match(/[A-Z]/g)?.length ?? 0) >= 2 : n.trim().includes(" "));
  // Both the accented and the plain spelling, so "medecins du monde" and "médecins du monde" are both found.
  return [...new Set(keys.flatMap((k) => [tidyQuery(k), tidyQuery(foldText(k))]))]
    // Not organization-type words, nor phrases made only of those and stop words ("UN Careers" is a portal, not a search for one agency).
    .filter((key) => key && !key.split(" ").every((w) => ORG_TYPE_WORDS.has(w) || STOP_WORDS.has(w)))
    .map((key) => ({ key, names }));
});
const ORG_ALIAS_INDEX = new Map<string, string[]>();
for (const a of ORG_ALIASES) ORG_ALIAS_INDEX.set(a.key, [...new Set([...(ORG_ALIAS_INDEX.get(a.key) ?? []), ...a.names])]);
/** Aliases of several words, longest first. */
const ORG_PHRASES = [...ORG_ALIAS_INDEX.keys()].filter((k) => k.includes(" ")).sort((a, b) => b.length - a.length);

/** Every folded name of the organization(s) a search term is an alias of ("msf" → "médecins sans frontières", …), or []. */
export function orgNamesForTerm(term: string): string[] {
  return ORG_ALIAS_INDEX.get(tidyQuery(term)) ?? ORG_ALIAS_INDEX.get(tidyQuery(foldText(term))) ?? [];
}

/**
 * Other names of common duty stations, folded (foldText): a search for any name in a group also
 * finds listings whose location uses another one ("geneve" finds Geneva, "kiev" finds Kyiv, "den
 * haag" finds The Hague). Accents never matter ("Genève" is folded to "geneve" first).
 */
const PLACE_ALIAS_GROUPS: string[][] = [
  ["geneva", "geneve", "genf", "ginevra"],
  ["kyiv", "kiev"],
  ["brussels", "bruxelles", "brussel"],
  ["the hague", "hague", "den haag", "la haye"],
  ["vienna", "wien"],
  ["rome", "roma"],
  ["new york", "ny", "nyc"],
  ["addis ababa", "addis abeba", "addis"],
];
const PLACE_ALIAS_INDEX = new Map<string, string[]>();
for (const g of PLACE_ALIAS_GROUPS) for (const name of g) PLACE_ALIAS_INDEX.set(name, g.filter((n) => n !== name));
/** Place names of several words (other than "the hague", whose "the" is dropped as a stop word anyway), longest first. */
const PLACE_PHRASES = [...PLACE_ALIAS_INDEX.keys()].filter((k) => k.includes(" ") && !k.startsWith("the ")).sort((a, b) => b.length - a.length);

/** The other names of the duty station a search term names ("geneve" → ["geneva", "genf", "ginevra"]), folded; [] for other terms. */
export function placeVariants(term: string): string[] {
  return PLACE_ALIAS_INDEX.get(tidyQuery(foldText(term))) ?? [];
}

/**
 * Takes organization and duty-station names of several words out of a tidied query, so they are
 * matched as one term ("doctors without borders", "den haag").
 */
function takeOrgPhrases(s: string): { phrases: string[]; rest: string } {
  let rest = ` ${s} `;
  const phrases: string[] = [];
  for (const p of ORG_PHRASES) {
    if (rest.includes(` ${p} `)) {
      phrases.push(p);
      rest = rest.replace(` ${p} `, " ");
    }
  }
  if (PLACE_PHRASES.some((p) => ` ${foldText(rest)} `.includes(` ${p} `))) {
    rest = ` ${foldText(rest).trim()} `;
    for (const p of PLACE_PHRASES) {
      if (rest.includes(` ${p} `)) {
        phrases.push(p);
        rest = rest.replace(` ${p} `, " ");
      }
    }
  }
  return { phrases, rest: rest.replace(/\s+/g, " ").trim() };
}

/** The terms of a search: organization names of several words stay together, everything else is one word each (at most 8). */
export function searchTerms(q: string): string[] {
  const { phrases, rest } = takeOrgPhrases(tidyQuery(q));
  return [...phrases, ...rest.split(" ").filter(Boolean)].slice(0, 8);
}

/**
 * Grades people type: P1–P7, D1–D2, NOA–NOE, G1–G7, GS1–GS7 and FS1–FS7, with or without the hyphen,
 * as a whole word. Written the way the importer stores grades (normalizeGrade in
 * src/lib/feeds/extract.ts) and parseFilters accepts them: "P-3", "NO-A", "GS-6".
 */
const GRADE_WORD_RE = /^(p|d|no|gs|g|fs)-?([1-7a-e])$/;
const GRADE_RANGES: Record<string, RegExp> = { p: /^[1-7]$/, d: /^[12]$/, no: /^[a-e]$/, g: /^[1-7]$/, gs: /^[1-7]$/, fs: /^[1-7]$/ };

/** The grade one search word names ("p3" → "P-3", "NO-B" → "NO-B", "gs6" → "GS-6"), or null. */
export function gradeFromWord(word: string): string | null {
  const m = word.toLowerCase().trim().match(GRADE_WORD_RE);
  return m && GRADE_RANGES[m[1]].test(m[2]) ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : null;
}

/**
 * The language filter value one search word names ("french", "Arabic" → "French", "Arabic"), or
 * null. Only the languages a search word may name (SEARCH_LANGUAGES in src/config/regions.ts), written as the
 * plain language name: "francophone" or "Spanish-speaking" are left as words.
 */
export function languageFromWord(word: string): string | null {
  const w = foldText(word.trim());
  return SEARCH_LANGUAGES.find((l) => l.toLowerCase() === w) ?? null;
}

/** Takes the first grade out of a tidied query (" p3 data " → "P-3" and " data "). */
function takeGrade(s: string): { grade?: string; word?: string; rest: string } {
  const words = s.split(" ");
  // "G5 Sahel" is an organization, not grade G-5.
  const i = words.findIndex((w, n) => gradeFromWord(w) && !(w === "g5" && words[n + 1] === "sahel"));
  if (i < 0) return { rest: s };
  const grade = gradeFromWord(words[i])!;
  const [word] = words.splice(i, 1);
  return { grade, word, rest: words.join(" ") };
}

/**
 * How a grade is written in titles, as a Postgres regex for the folded title: "P-3" also as "P3"
 * and "P 3", "NO-B" as "NOB", "G-6" as "G6" or "[G6]".
 */
export function gradeTitlePattern(grade: string): string | null {
  const m = grade.toLowerCase().match(/^([a-z]{1,2})-([0-9a-e])$/);
  return m ? `\\m${m[1]}[- ]?${m[2]}\\M` : null;
}

const wordRe = (phrase: string) => new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`);

export function interpretQuery(q: string | undefined | null): SearchIntent {
  return readQuery(q).intent;
}

/** The words the search's filters were read from, and its quoted phrases (see QueryWords). */
export function queryWords(q: string | undefined | null): QueryWords {
  const { from } = readQuery(q);
  return { from, exact: quotedPhrases(q) };
}

function readQuery(q: string | undefined | null): { intent: SearchIntent; from: QueryWords["from"] } {
  if (!q) return { intent: { text: null }, from: {} };
  // Organization names of several words are kept whole ("doctors of the world" keeps "of the").
  const { phrases, rest } = takeOrgPhrases(tidyQuery(q));
  let s = ` ${rest} `;
  const intent: SearchIntent = { text: null };

  const from: QueryWords["from"] = {};
  const g = takeGrade(s);
  if (g.grade) {
    intent.grade = g.grade;
    from.grade = g.grade;
    s = ` ${g.rest} `;
  }

  for (const [phrase, value] of ORG_TYPE_PHRASES) {
    const re = wordRe(phrase);
    if (re.test(s)) {
      intent.orgtype ??= value;
      s = s.replace(re, " ");
    }
  }
  for (const phrase of REMOTE_PHRASES) {
    const re = wordRe(phrase);
    if (re.test(s)) {
      intent.remote = true;
      s = s.replace(re, " ");
    }
  }
  for (const [name, slug] of COUNTRY_NAMES) {
    const re = wordRe(name);
    if (re.test(s)) {
      intent.country ??= slug;
      from.country ??= name;
      s = s.replace(re, " ");
      break;
    }
  }
  for (const phrase of ENTRY_PHRASES) {
    const re = wordRe(phrase);
    if (re.test(s)) {
      intent.exp = "0-2";
      s = s.replace(re, " ");
    }
  }
  // One region (after countries: "south africa" is a country). A second region word, or one next
  // to a country, is taken out too: the more specific place, or the first region, is the filter.
  for (const [phrase, slug] of REGION_PHRASES) {
    const re = wordRe(phrase);
    if (re.test(s)) {
      if (!intent.country && !intent.region) from.region = phrase;
      if (!intent.country) intent.region ??= slug;
      s = s.replace(re, " ");
    }
  }

  const words = s.split(" ").filter(Boolean);
  const kept: string[] = [...phrases];
  for (const w of words) {
    if (REMOTE_WORDS.has(w)) intent.remote = true;
    else if (ENTRY_WORDS.has(w)) intent.exp = "0-2";
    else if (INTERNSHIP_WORDS.has(w)) { intent.type = "Internship"; from.type = w; }
    else if (CONSULTANCY_WORDS.has(w)) { from.type = intent.type ? from.type : w; intent.type ??= "Consultancy"; }
    else if (VOLUNTEER_WORDS.has(w)) { from.type = intent.type ? from.type : w; intent.type ??= "Volunteer"; }
    else if (FELLOWSHIP_WORDS.has(w)) { from.type = intent.type ? from.type : w; intent.type ??= "Fellowship"; }
    // One language: a second one ("french arabic") stays a search word.
    else if (languageFromWord(w) && (intent.lang ?? languageFromWord(w)) === languageFromWord(w)) intent.lang = languageFromWord(w)!;
    else if (!STOP_WORDS.has(w)) kept.push(w);
  }
  intent.text = kept.length ? kept.join(" ") : null;
  return { intent, from };
}

/**
 * The singular of a search word, for matching: "engineers" → "engineer", "nurses" → "nurse",
 * "branches" → "branch". Words under 5 letters and ones ending in -ss, -us or -is are left alone
 * ("class", "status", "analysis"); "-ies" is handled by wordPattern.
 */
export function singular(term: string): string {
  if (term.length < 5 || !/^[a-z0-9]+$/.test(term)) return term;
  if (/(ss|us|is|ies)$/.test(term)) return term;
  if (/(ches|shes|sses|xes|zes)$/.test(term)) return term.slice(0, -2);
  return term.endsWith("s") ? term.slice(0, -1) : term;
}

/**
 * Postgres regex for a word (or the start of one, for longer words) as a whole token. A plural
 * finds the singular too: "engineers" matches "Engineer", "agencies" matches "Agency".
 */
export function wordPattern(term: string): string {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (term.length <= 4) return `\\m${esc(term)}\\M`;
  // A plural matches the word and its singular as whole words only: "units" never "United",
  // "plans" never "Planning".
  if (/^[a-z0-9]+ies$/.test(term) && term.length >= 7) return `\\m${esc(term.slice(0, -3))}(y|ies)\\M`;
  const one = singular(term);
  if (one !== term) return `\\m(${esc(one)}|${esc(term)})\\M`;
  return `\\m${esc(term)}`;
}

/**
 * Categories whose name contains a search word, matched like wordPattern: short words (4 letters
 * or fewer) as whole words, longer ones also as the start of a word ("health" → Health,
 * "procure" → Procurement and logistics). Never "Other".
 */
export function categoriesForWord(word: string): string[] {
  const abbr = ABBREVIATIONS[word.toLowerCase()];
  if (abbr) return abbr.categories;
  const w = singular(word.toLowerCase());
  if (!/^[a-z0-9]+$/.test(w)) return [];
  return CATEGORIES.filter((c) =>
    c.name.toLowerCase().split(/[^a-z0-9]+/).some((x) => x && x !== "and" && (x === w || (w.length > 4 && x.startsWith(w)))),
  ).map((c) => c.slug);
}
