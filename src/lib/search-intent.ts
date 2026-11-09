/**
 * Reading what people mean when they type a search: "un jobs in kenya",
 * "remote internship", "eu vacancies". Known words become filters and the
 * rest is matched against titles, organizations and descriptions.
 */
import { CATEGORIES } from "@/config/categories";
import { COUNTRIES } from "@/config/countries";
import { LANGUAGES } from "@/config/regions";
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
};

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
const tidyQuery = (s: string) => s.toLowerCase().replace(/[“”"'’,;:!?()]/g, " ").replace(/\s+/g, " ").trim();

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
 * null. Only the languages the filter offers (LANGUAGES in src/config/regions.ts), written as the
 * plain language name: "francophone" or "Spanish-speaking" are left as words.
 */
export function languageFromWord(word: string): string | null {
  const w = foldText(word.trim());
  return LANGUAGES.find((l) => l.toLowerCase() === w) ?? null;
}

/** Takes the first grade out of a tidied query (" p3 data " → "P-3" and " data "). */
function takeGrade(s: string): { grade?: string; rest: string } {
  const words = s.split(" ");
  // "G5 Sahel" is an organization, not grade G-5.
  const i = words.findIndex((w, n) => gradeFromWord(w) && !(w === "g5" && words[n + 1] === "sahel"));
  if (i < 0) return { rest: s };
  const grade = gradeFromWord(words[i])!;
  words.splice(i, 1);
  return { grade, rest: words.join(" ") };
}

const wordRe = (phrase: string) => new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`);

export function interpretQuery(q: string | undefined | null): SearchIntent {
  if (!q) return { text: null };
  // Organization names of several words are kept whole ("doctors of the world" keeps "of the").
  const { phrases, rest } = takeOrgPhrases(tidyQuery(q));
  let s = ` ${rest} `;
  const intent: SearchIntent = { text: null };

  const g = takeGrade(s);
  if (g.grade) {
    intent.grade = g.grade;
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
      s = s.replace(re, " ");
      break;
    }
  }

  const words = s.split(" ").filter(Boolean);
  const kept: string[] = [...phrases];
  for (const w of words) {
    if (REMOTE_WORDS.has(w)) intent.remote = true;
    else if (INTERNSHIP_WORDS.has(w)) intent.type = "Internship";
    else if (CONSULTANCY_WORDS.has(w)) intent.type ??= "Consultancy";
    else if (VOLUNTEER_WORDS.has(w)) intent.type ??= "Volunteer";
    else if (FELLOWSHIP_WORDS.has(w)) intent.type ??= "Fellowship";
    // One language: a second one ("french arabic") stays a search word.
    else if (languageFromWord(w) && (intent.lang ?? languageFromWord(w)) === languageFromWord(w)) intent.lang = languageFromWord(w)!;
    else if (!STOP_WORDS.has(w)) kept.push(w);
  }
  intent.text = kept.length ? kept.join(" ") : null;
  return intent;
}

/** Postgres regex for a word (or the start of one, for longer words) as a whole token. */
export function wordPattern(term: string): string {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return term.length <= 4 ? `\\m${esc}\\M` : `\\m${esc}`;
}

/**
 * Categories whose name contains a search word, matched like wordPattern: short words (4 letters
 * or fewer) as whole words, longer ones also as the start of a word ("health" → Health,
 * "procure" → Procurement and logistics). Never "Other".
 */
export function categoriesForWord(word: string): string[] {
  const w = word.toLowerCase();
  if (!/^[a-z0-9]+$/.test(w)) return [];
  return CATEGORIES.filter((c) =>
    c.name.toLowerCase().split(/[^a-z0-9]+/).some((x) => x && x !== "and" && (x === w || (w.length > 4 && x.startsWith(w)))),
  ).map((c) => c.slug);
}
