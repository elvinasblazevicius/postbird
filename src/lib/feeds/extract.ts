/**
 * Turns one raw feed item into a structured job. Every field is taken
 * from the item itself (title, labelled lines in the text, feed tags,
 * link domain). When a value isn't clearly present it stays null and
 * the site shows "Not specified".
 */
import { CATEGORIES, OTHER_CATEGORY } from "@/config/categories";
import { COUNTRIES, countryByCode } from "@/config/countries";
import { DUTY_STATIONS } from "@/config/cities";
import { KNOWN_ORGS, type KnownOrg } from "@/config/organizations";
import { LANGUAGE_ALIASES, LANGUAGES } from "@/config/regions";
import { IMPORT_SETTINGS } from "@/config/import";
import { escapeRegExp, excerpt, htmlToText, normalizeForCompare, oneLine, sanitizeDescriptionMax, slugify } from "@/lib/text";
import { extractDeadline, parseFeedDate } from "./dates";
import type { RawItem } from "./parse";
import { cleanTitle, titleForSlug } from "./title";
import { canonicalizeUrl, hostOf, isListingSite, pickApplyUrl, sha256 } from "./url";
import { allLinks, endsWithHost, findEmployerLink, findOrgWebsite, PROCUREMENT_HOSTS } from "./employer-link";

export type ContentPolicy = "none" | "excerpt" | "full";

export type FeedContext = {
  id: number;
  name: string;
  defaultOrganization: string | null;
  contentPolicy: ContentPolicy;
};

export type OrgRef = { name: string; slug: string; short: string | null; type: string | null; website: string | null };

export type NormalizedJob = {
  title: string;
  slug: string;
  organization: OrgRef | null;
  countryCode: string | null;
  city: string | null;
  locationText: string | null;
  isRemote: boolean | null;
  category: string;
  jobType: string | null;
  grade: string | null;
  /** Languages (besides English) the posting requires. */
  languages: string[] | null;
  /** Languages (besides English) the posting calls an advantage or desirable. */
  desirableLanguages: string[] | null;
  minExperienceYears: number | null;
  reference: string | null;
  summary: string | null;
  descriptionHtml: string | null;
  contentPolicy: ContentPolicy;
  /** Where to apply: always the employer's own link (never a job board). */
  applyUrl: string;
  applyHost: string;
  /** Host of the feed item's own link (used to tell sites apart when merging duplicates). */
  sourceHost: string;
  /** Identifies the feed item: hash of its own canonical link. */
  urlHash: string;
  fingerprint: string | null;
  publishedAt: Date | null;
  deadline: string | null;
  guid: string | null;
  sourceTitle: string | null;
};

export class ItemSkipped extends Error {}

// ── Lookup tables ────────────────────────────────────────────

type Matcher = { re: RegExp; value: string; len: number };

function phraseRegex(phrase: string): RegExp {
  const prefix = phrase.endsWith("*");
  const core = escapeRegExp(normalizeForCompare(prefix ? phrase.slice(0, -1) : phrase));
  return new RegExp(`(?:^|\\s)${core}${prefix ? "" : "(?=\\s|$)"}`);
}

const COUNTRY_NAMES = new Map<string, string>(
  COUNTRIES.flatMap((c) => [c.name, ...c.aliases].map((n) => [normalizeForCompare(n), c.code] as [string, string])),
);

const COUNTRY_MATCHERS: Matcher[] = COUNTRIES.flatMap((c) =>
  [c.name, ...c.aliases].map((n) => ({ re: phraseRegex(n), value: c.code, len: n.length })),
).sort((a, b) => b.len - a.len);

const CITY_MATCHERS: Matcher[] = Object.keys(DUTY_STATIONS)
  .map((city) => ({ re: phraseRegex(city), value: city, len: city.length }))
  .sort((a, b) => b.len - a.len);

const ORG_INDEX = new Map<string, KnownOrg>();
for (const o of KNOWN_ORGS) {
  for (const n of [o.name, o.short, ...(o.aliases ?? [])]) if (n) ORG_INDEX.set(normalizeForCompare(n), o);
}

const CATEGORY_MATCHERS = CATEGORIES.map((c) => ({ slug: c.slug, res: c.keywords.map(phraseRegex) }));

// ── Helpers ──────────────────────────────────────────────────

/** Countries mentioned in a short text, longest names first, without overlaps. */
export function findCountries(text: string): string[] {
  let s = ` ${normalizeForCompare(text)} `;
  const found: string[] = [];
  for (const m of COUNTRY_MATCHERS) {
    const hit = s.match(m.re);
    if (hit && hit.index !== undefined) {
      if (!found.includes(m.value)) found.push(m.value);
      s = s.slice(0, hit.index) + " ".repeat(hit[0].length) + s.slice(hit.index + hit[0].length);
    }
  }
  return found;
}

export function findCity(text: string): string | null {
  const s = ` ${normalizeForCompare(text)} `;
  for (const m of CITY_MATCHERS) if (m.re.test(s)) return m.value;
  return null;
}

export function knownOrgByName(name: string | null | undefined): KnownOrg | undefined {
  if (!name) return undefined;
  const direct = ORG_INDEX.get(normalizeForCompare(name));
  if (direct) return direct;
  // Job boards often shorten "United Nations" to "UN" and write "Program" for "Programme".
  const variant = name.replace(/^\s*UN\s+/, "United Nations ").replace(/\bProgram\b/g, "Programme");
  return variant !== name ? ORG_INDEX.get(normalizeForCompare(variant)) : undefined;
}

export function knownOrgByHost(host: string): KnownOrg | undefined {
  if (!host) return undefined;
  return KNOWN_ORGS.find((o) => o.domains?.some((d) => host === d || host.endsWith(`.${d}`)));
}

/**
 * Shared recruitment sites that put the employer's account name in the address
 * (jobs.smartrecruiters.com/OECD/…): the organization named there, if it is a known one.
 */
export function knownOrgByAtsPath(url: string): KnownOrg | undefined {
  try {
    const u = new URL(url);
    if (!/(^|\.)smartrecruiters\.com$/i.test(u.hostname)) return undefined;
    const account = decodeURIComponent(u.pathname.split("/")[1] ?? "");
    return account ? knownOrgByName(account) : undefined;
  } catch {
    return undefined;
  }
}

function toOrgRef(name: string): OrgRef {
  const known =
    knownOrgByName(name) ??
    name.split(/\s[-–—|]\s|\(|\)|,/).map((p) => knownOrgByName(p)).find(Boolean);
  if (known) return { name: known.name, slug: slugify(known.short && known.short.length <= 12 ? known.short : known.name, 60), short: known.short ?? null, type: known.type, website: known.domains?.[0] ?? null };
  const clean = oneLine(name).slice(0, 120);
  return { name: clean, slug: slugify(clean, 60), short: null, type: null, website: null };
}

const ORGISH = /\b(organi[sz]ation|fund|programme|program|agency|bank|council|committee|office|institute|foundation|international|united nations|union|commission|association|society|federation|mission|cent(re|er)|secretariat|ngo|alliance|network|trust|unit|authority|court|tribunal|initiative|partnership|facility|corps|rescue|relief|aid|care|vision|children)\b/i;

/**
 * Read "Label: value" pairs from text lines. Values stop at a pipe,
 * semicolon, bullet or the next "Label:" on the same line.
 */
function labelled(text: string, labels: string[], maxLen = 120, allowSemicolon = false): string | null {
  const stop = allowSemicolon ? "\\n|•" : "\\n|•;";
  const re = new RegExp(`(?:^|[\\n|•;,.]|\\s{2,})\\s*(?:${labels.join("|")})\\s*(?:\\([^)]{0,30}\\))?\\s*[:：]\\s*([^${stop}]{1,${maxLen + 40}})`, "i");
  const m = text.match(re);
  if (!m) return null;
  let v = m[1];
  // cut at the next "Something:" label on the same line
  v = v.replace(/\s{2,}\S[^:]{0,30}:.*$/, "").replace(/\s+[A-Z][A-Za-z /]{2,30}:\s.*$/, "");
  v = v.trim().replace(/[.,;]+$/, "");
  return v && v.length <= maxLen ? v : null;
}

const LOCATION_LABELS = ["duty stations?", "duty station\\(s\\)", "location\\(s\\)", "locations?", "job location", "work location", "place of assignment", "place of performance", "lieu d['’]affectation", "lugar de destino", "country of assignment"];
const COUNTRY_LABELS = ["countr(?:y|ies)", "pays", "pa[ií]s"];
const CITY_LABELS = ["city", "ville", "ciudad"];
const ORG_LABELS = ["organi[sz]ation", "hiring organi[sz]ation", "agency", "employer", "entity", "organisme", "organismo"];
const GRADE_LABELS = ["grade", "grade level", "level", "post level", "category and level"];
const TYPE_LABELS = ["contract type", "type of contract", "contract", "appointment type", "type of appointment", "employment type", "vacancy type", "job type", "position type", "contract modality"];
const REF_LABELS = ["job id", "job opening id", "job opening number", "vacancy (?:number|no\\.?|notice(?: number)?)", "requisition(?: id| number)?", "reference(?: number| no\\.?)?", "ref\\.?", "va(?: no\\.?| number)", "post number", "position number"];

/**
 * EU staff grades: AD 5 to AD 16 (administrators), AST 1 to AST 11 (assistants), AST/SC 1 to
 * AST/SC 6 (secretaries and clerks), and contract agents' function groups FG I to FG IV.
 */
const EU_GRADE_SOURCE = "AST ?[/-] ?SC ?-? ?[1-6]|AST ?-? ?(?:1[01]|[1-9])|AD ?-? ?(?:1[0-6]|[5-9])|FG ?-? ?(?:IV|I{1,3})";
/**
 * Grades: UN common system (P, D, NO, G/GS, FS, ASG/USG), UN service contracts (SB, LICA, NPSA,
 * IPSA, ICS), EU staff (EU_GRADE_SOURCE) and the World Bank Group and IFC (GA to GK).
 */
const UN_EU_GRADE_SOURCE = `USG|ASG|${EU_GRADE_SOURCE}|D-?[12]|P-?[1-7]|NO-?[A-E]|G-?[1-7]|GS-?[1-7]|FS-?[1-7]|SB-?[1-5]|LICA-?\\d{1,2}|NPSA-?\\d{1,2}|IPSA-?\\d{1,2}|ICS-?\\d{1,2}`;
const GRADE_RE = new RegExp(`\\b(${UN_EU_GRADE_SOURCE}|G[A-K])\\b`);
/**
 * A title segment that is only a grade. World Bank Group grades are read from a "Grade:" line only:
 * in a title, "GA" is more often a place ("Atlanta, GA") than a grade.
 */
const TITLE_SEGMENT_GRADE_RE = new RegExp(`^(${UN_EU_GRADE_SOURCE})$`);
/** An EU grade anywhere in a title ("Contract Agent FG IV - Data Analyst"): the forms are distinctive enough. */
const EU_TITLE_GRADE_RE = new RegExp(`\\b(${EU_GRADE_SOURCE})\\b`);

/** A grade as stored: "P-3", "NO-B", "USG", "AD-6", "AST/SC-2", "FG-IV", "GG" (see gradeText in src/lib/grades.ts). */
export function normalizeGrade(g: string): string {
  const u = g.toUpperCase().replace(/\s+/g, " ").trim();
  const sc = u.match(/^AST ?[/-] ?SC ?-? ?([1-6])$/);
  if (sc) return `AST/SC-${sc[1]}`;
  const eu = u.match(/^(AD|AST|FG) ?-? ?(\d{1,2}|IV|I{1,3})$/);
  if (eu) return `${eu[1]}-${eu[2]}`;
  if (/^G[A-K]$/.test(u)) return u;
  const m = u.match(/^(USG|ASG|NO|GS|FS|SB|LICA|NPSA|IPSA|ICS|D|P|G)-?(\w+)$/);
  if (!m) return u;
  if (m[1] === "USG" || m[1] === "ASG") return m[1];
  return `${m[1]}-${m[2]}`;
}

/** The grade from a "Grade:" line, a title segment that is only a grade ("(P-3)", "- AD 6"), or an EU grade anywhere in the title. */
export function detectGrade(title: string, gradeLabel: string | null): string | null {
  const titleGrade = [...title.matchAll(/\(([^)]{1,20})\)/g)].map((m) => m[1])
    .concat(title.split(/\s[-–—|]\s|,|\//))
    .map((x) => x.trim())
    .find((x) => TITLE_SEGMENT_GRADE_RE.test(x));
  const m = (gradeLabel && gradeLabel.match(GRADE_RE)) || (titleGrade ? titleGrade.match(TITLE_SEGMENT_GRADE_RE) : null) || title.match(EU_TITLE_GRADE_RE);
  return m ? normalizeGrade(m[1]) : null;
}

export function detectJobType(text: string): string | null {
  const t = text.toLowerCase();
  if (/\btrainee(ship)?s?\b/.test(t)) return "Traineeship";
  if (/\binterns?(hip)?\b|\bstagiaire\b|\bpasant[ií]a\b/.test(t)) return "Internship";
  if (/\bfellow(ship)?s?\b/.test(t)) return "Fellowship";
  if (/\b(un )?volunteers?\b|\bunv\b/.test(t)) return "Volunteer";
  // EU staff categories: contract staff (CAST, function groups FG I to IV) and temporary staff.
  if (/\bcontract agents?\b/.test(t)) return "Contract agent";
  if (/\btemporary agents?\b/.test(t)) return "Temporary agent";
  if (/\bconsult(ant|ancy|ancies|ants)\b|\bindividual contractor\b|\bindividual consultant\b|\bfreelance\b/.test(t)) return "Consultancy";
  if (/\btemporary( appointment| job opening| position)?\b|\bshort[- ]term\b/.test(t)) return "Temporary";
  if (/\bfixed[- ]term\b|\bcontinuing appointment\b|\bpermanent\b|\bfta\b/.test(t)) return "Fixed-term";
  if (/\bpart[- ]time\b/.test(t)) return "Part-time";
  return null;
}

export function detectCategory(title: string): string {
  const s = ` ${normalizeForCompare(title)} `;
  for (const c of CATEGORY_MATCHERS) if (c.res.some((re) => re.test(s))) return c.slug;
  return OTHER_CATEGORY.slug;
}

/** Each language with every name it is written with (LANGUAGE_ALIASES: "Farsi" is Persian). */
const LANGUAGE_NAMES: readonly { lang: string; names: string[] }[] = LANGUAGES.map((lang) => ({
  lang,
  names: [lang, ...Object.entries(LANGUAGE_ALIASES).filter(([, l]) => l === lang).map(([alias]) => alias)],
}));
const ALL_LANGUAGE_NAMES = LANGUAGE_NAMES.flatMap((l) => l.names);
/**
 * What may follow a language name when it names something else: a place ("French Polynesia",
 * "Czech Republic"), an organization or government ("Danish Refugee Council", "German Agency for
 * International Cooperation", "Swedish Embassy"), people ("Polish nationals"), or a place where a
 * language is spoken ("Spanish-speaking countries").
 */
const NOT_A_LANGUAGE_AFTER = "(?! Polynesia| Guiana| Southern| Republic| Refugee| Red Cross| Red Crescent| Church| Government| Ministry| Embassy| Agency| Council| Institute| International| Development| Relief| Humanitarian| Aid\\b| Cooperation| Presidency| authorities| nationals?\\b| citizens?\\b| nationality| National\\b| Region| regional| State\\b| communit| population| people| Cypriot| lira| Gulf| encephalitis| Army| Armed| Forces| Police|-language|[- ]speaking (?:countr|region|area|world|communit|populat|context|environment|africa|west|east|central|north|south|nation|state|people))";
/** Languages named as alternatives: "one of the following: French, Spanish", "either French or Spanish". */
const ANY_OF_MARK = /\b(?:(?:one|any) of the following|(?:one|any) of|either)\b/gi;
const LANG_CONTEXT = /\b(fluen\w*|proficien\w*|knowledge of|command of|written and (?:oral|spoken)|spoken and written|oral and written|bilingual|mother tongue|native speaker|language (?:skills?|requirements?|proficiency)|required|essential|mandatory|obligatory|must\s+(?:be\s+able\s+to\s+)?(?:speak|read|write|understand|communicate|be fluent|be proficient|have)|speak|speaks|speaking|spoken|desirable|an asset|advantage|preferred)\b|\blanguages?\s*[:：]/i;
/** Words that make a language a plus rather than a requirement ("… is an advantage", "Desirable: French"). */
const DESIRABLE_MARK = /\b(?:advantage\w*|advantageous|desirable|desired|assets?|preferred|preferabl[ey]|a plus|added value|nice to have|beneficial)\b/gi;
/** Words that make it a requirement ("… is required", "Essential: French"). */
const REQUIRED_MARK = /\b(?:required|requirements?|essential|mandatory|must|necessary|indispensable)\b/gi;
/**
 * "another official UN language (Arabic, Chinese, French, Russian and Spanish)" and the like: a list
 * of the UN's official languages, any one of which counts, so it names no language the job needs.
 * The phrase is removed together with its list (in brackets, or after "such as", "e.g." …, which
 * detectLanguageRequirements has already written as "eg").
 */
const OTHER_UN_LANGUAGE =
  /\b(?:another|other|an additional|a second|a further|one of the other)\s+(?:official\s+)?(?:UN|U\.N\.|United Nations)\s+(?:official\s+)?languages?\b(?:\s*\([^)]*\)|,?\s*(?:such as|eg|ie|namely|including|like)\s+[^;.()]*?(?=\s+(?:is|are|would|will|an?|as)\b|[;.]|$))?/gi;

export type LanguageRequirements = { required: string[] | null; desirable: string[] | null };

/** "French or Spanish", "English, French and/or Spanish": languages joined by "or" (English included, so "English or French" counts). */
const OR_CHAIN = (() => {
  const lang = `(?:English|${ALL_LANGUAGE_NAMES.join("|")})`;
  return new RegExp(`\\b${lang}(?:\\s*,\\s*${lang})*\\s*,?\\s+(?:and\\/or|or)\\s+${lang}\\b`, "gi");
})();

/**
 * Languages (other than English) named in sentences about language requirements, split into
 * required and desirable. A language counts as desirable when the nearest marker after it in its
 * sentence (or, with none after it, the nearest one before it) is "advantage", "desirable", "an
 * asset", "preferred" and the like; otherwise it is required. A language named as one of several
 * alternatives ("German or Italian is required", "English and one of the following: French,
 * Spanish") is not required on its own, so it is kept with the desirable ones (any of them).
 * A language named both ways is required.
 */
export function detectLanguageRequirements(text: string): LanguageRequirements {
  const required = new Set<string>();
  const desirable = new Set<string>();
  // "e.g." and "i.e." don't end a sentence ("another UN language (e.g. Arabic, Chinese) is desirable").
  const plain = text.replace(/\be\.g\./gi, "eg").replace(/\bi\.e\./gi, "ie");
  for (const raw of plain.split(/(?<=[.;!?])\s+|\n/)) {
    if (raw.length > 600 || !LANG_CONTEXT.test(raw)) continue;
    if (/\b(working|official) languages?\b/i.test(raw)) continue; // describes the organization, not the job
    const sentence = raw.replace(OTHER_UN_LANGUAGE, (m) => " ".repeat(m.length));
    const marks = [
      ...[...sentence.matchAll(DESIRABLE_MARK)].map((m) => ({ at: m.index ?? 0, desirable: true })),
      ...[...sentence.matchAll(REQUIRED_MARK)].map((m) => ({ at: m.index ?? 0, desirable: false })),
    ].sort((a, b) => a.at - b.at);
    // Where alternatives are named: after "one of the following" / "either", and within "French or Spanish".
    const anyOfFrom = [...sentence.matchAll(ANY_OF_MARK)].map((m) => m.index ?? 0);
    const orChains = [...sentence.matchAll(OR_CHAIN)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
    const isAlternative = (at: number) => anyOfFrom.some((from) => from < at) || orChains.some(([a, b]) => at >= a && at < b);
    for (const { lang, names } of LANGUAGE_NAMES) {
      // "French" but not "French Polynesia", nor "Spanish-speaking countries" (a place, not a language the job needs)
      for (const m of sentence.matchAll(new RegExp(`\\b(?:${names.join("|")})\\b${NOT_A_LANGUAGE_AFTER}`, "gi"))) {
        const at = m.index ?? 0;
        const mark = marks.find((k) => k.at > at) ?? [...marks].reverse().find((k) => k.at < at);
        (mark?.desirable || isAlternative(at) ? desirable : required).add(lang);
      }
    }
  }
  for (const l of required) desirable.delete(l);
  return { required: required.size ? [...required].sort() : null, desirable: desirable.size ? [...desirable].sort() : null };
}

/** Required languages (other than English) named in sentences about language requirements. */
export function detectLanguages(text: string): string[] | null {
  return detectLanguageRequirements(text).required;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/**
 * Minimum years of experience from phrases like "a minimum of five (5) years of ... experience",
 * "5+ years experience", "3 years' relevant experience" or "Experience: 5 years minimum".
 * Without "of", at most two words may stand between "years" and "experience", none of them a
 * linking word ("2 years contract with experience in GIS" is a duration, not a requirement).
 */
export function detectExperienceYears(text: string): number | null {
  const N = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";
  const years = `${N}(?:\\s*(?:-|–|to)\\s*\\d{1,2})?(?:\\s*\\(\\d{1,2}\\))?\\s*\\+?\\s*(?:or more\\s+)?years?(?:['’]s?)?`;
  const between = "(?:of\\s+(?:[\\w-]+\\s+){0,5}?|(?:(?!(?:with|and|or|in|on|for|to|the|a|an|as|at|by|from|contract|duration|period|assignment|appointment)\\b)[\\w-]+\\s+){0,2}?)";
  const forward = new RegExp(`\\b${years}\\s+${between}experience\\b`, "i");
  const backward = new RegExp(`\\bexperience\\s+of\\s+(?:at least|a minimum of|minimum|over)?\\s*${N}(?:\\s*\\(\\d{1,2}\\))?\\s*\\+?\\s*years?\\b`, "i");
  // "Experience: 5 years minimum", "Work experience: at least 3 years".
  const labelled = new RegExp(`\\bexperience\\s*[:：]\\s*(?:at least|a minimum of|minimum|min\\.?|over)?\\s*${N}(?:\\s*\\(\\d{1,2}\\))?\\s*\\+?\\s*years?\\b`, "i");
  const m = text.match(forward) ?? text.match(backward) ?? text.match(labelled);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  return n !== undefined && n >= 0 && n <= 30 ? n : null;
}

const REMOTE_RE = /\b(remote|home[- ]?based|work from home|working from home|telework(ing)?|telecommut(e|ing)|t[ée]l[ée]travail|teletrabajo)\b/i;

/** Names that are also common words, US states or personal names: trusted only in labelled fields. */
const AMBIGUOUS_PLACES = new Set(["georgia", "jordan", "chad", "guinea", "niger", "mali", "turkey", "panama", "lebanon"]);
const PLACEHOLDER_RE = /\b(tbd|tba|to be (?:determined|confirmed)|n\/?a|various|multiple|several|any|office|country office|headquarters|hq|field|global|worldwide|anywhere)\b/i;

/**
 * A title segment counts as a place only if it consists of place names and
 * nothing else ("Nairobi, Kenya" yes; "Paris Agreement" or "New Mexico" no).
 */
function placeOnly(segment: string): { countries: string[]; city: string | null } | null {
  let rest = ` ${normalizeForCompare(segment)} `;
  const countries: string[] = [];
  let city: string | null = null;
  for (const m of CITY_MATCHERS) {
    const hit = rest.match(m.re);
    if (hit && hit.index !== undefined) {
      city ??= m.value;
      rest = rest.slice(0, hit.index) + " " + rest.slice(hit.index + hit[0].length);
    }
  }
  for (const m of COUNTRY_MATCHERS) {
    const hit = rest.match(m.re);
    if (hit && hit.index !== undefined) {
      if (!countries.includes(m.value)) countries.push(m.value);
      rest = rest.slice(0, hit.index) + " " + rest.slice(hit.index + hit[0].length);
    }
  }
  if (!countries.length && !city) return null;
  const leftover = rest.replace(/\b(and|or|based|in|duty|station|with|travel|to)\b/g, " ").trim();
  if (leftover) return null;
  const words = normalizeForCompare(segment);
  if (!city && countries.length === 1 && AMBIGUOUS_PLACES.has(words)) return null;
  return { countries, city };
}

/** Split a title into trailing segments that may hold a location, e.g. "Analyst - Nairobi, Kenya". */
function titleTailSegments(title: string): string[] {
  const parts = title.split(/\s[-–—|]\s|\s\/\s|\(|\)/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(1) : [];
}

/** "(France)" after a territory ("Nouméa, New Caledonia (France)"): the administering country, not where the post is. */
const ADMINISTERING_COUNTRY_RE = /\s*\((?:France|United Kingdom|UK|Netherlands|United States(?: of America)?|USA|Denmark|Norway|Australia|New Zealand|China)\)/gi;

export function stripAdministeringCountry(text: string): string {
  return text.replace(ADMINISTERING_COUNTRY_RE, "");
}

/**
 * A stored listing's country worked out again with the current rules, from what is stored: the
 * location text (the territory, not the administering country in brackets), else a title segment
 * that is only a place ("Analyst - Nairobi, Kenya"), else a known duty station in either. Returns
 * the country code when exactly one country is named, null when none or several (the importer then
 * keeps no single country). Used by scripts/reclassify.ts for listings no longer re-read by a sync.
 */
export function countryFromStoredPlace(title: string, locationText: string | null): string | null {
  const loc = locationText ? stripAdministeringCountry(locationText) : "";
  let countries = loc ? findCountries(loc) : [];
  let city: string | null = loc ? findCity(loc) : null;
  if (countries.length === 0) {
    for (const seg of titleTailSegments(title)) {
      const place = placeOnly(seg);
      if (place && place.countries.length) { countries = place.countries; break; }
      if (place?.city) city ??= place.city;
    }
  }
  if (countries.length === 1) return countries[0];
  if (countries.length === 0 && city) return DUTY_STATIONS[city] ?? null;
  return null;
}

// ── Main ─────────────────────────────────────────────────────

export function normalizeItem(raw: RawItem, feed: FeedContext): NormalizedJob {
  const title = cleanTitle(oneLine(raw.title)).slice(0, 300);
  if (!title) throw new ItemSkipped("Item has no title");
  if (IMPORT_SETTINGS.skipTitlePatterns.some((re) => re.test(title))) throw new ItemSkipped("Looks like a tender or supplier call, not a job");

  const sourceUrl = pickApplyUrl(raw.links);
  if (!sourceUrl) throw new ItemSkipped("Item has no link to the original vacancy");
  const sourceHost = hostOf(sourceUrl);
  if (IMPORT_SETTINGS.excludedSourceHosts.some((h) => endsWithHost(sourceHost, [h]))) throw new ItemSkipped("Source not used on this site (Import settings: excludedSourceHosts)");

  const bodyHtml = raw.contentHtml || raw.summaryHtml || "";
  // Job-board items: link to the employer's own application page, never to the board.
  let applyUrl = sourceUrl;
  if (isListingSite(sourceHost)) {
    const employer = findEmployerLink(bodyHtml);
    if (!employer && allLinks(bodyHtml).some((u) => endsWithHost(hostOf(u), PROCUREMENT_HOSTS))) throw new ItemSkipped("Links to a procurement notice (tender), not a job");
    if (!employer) throw new ItemSkipped("Job-board listing without a link to the employer's own vacancy (for example, apply by email)");
    applyUrl = employer;
  }
  if (endsWithHost(hostOf(applyUrl), PROCUREMENT_HOSTS)) throw new ItemSkipped("Links to a procurement notice (tender), not a job");
  const applyHost = hostOf(applyUrl);
  const text = htmlToText(bodyHtml);
  const head = text.slice(0, 4000); // labelled facts sit near the top

  // Organization
  let orgName: string | null = null;
  const labelledOrg = labelled(head, ORG_LABELS, 120);
  const hostOrg = knownOrgByHost(applyHost) ?? knownOrgByAtsPath(applyUrl);
  const authorOrg = knownOrgByName(raw.author);
  const sourceOrg = knownOrgByName(raw.sourceTitle?.replace(/\b(jobs?|careers?|vacanc(y|ies)|opportunities|rss|feed)\b/gi, ""));
  let titleOrg: KnownOrg | undefined;
  const prefix = title.match(/^([^:]{2,60}):\s/);
  if (prefix) titleOrg = knownOrgByName(prefix[1]);
  if (!titleOrg) for (const seg of titleTailSegments(title)) { titleOrg = knownOrgByName(seg); if (titleOrg) break; }

  if (feed.defaultOrganization) orgName = feed.defaultOrganization;
  else if (labelledOrg) orgName = labelledOrg;
  else if (hostOrg) orgName = hostOrg.name;
  else if (authorOrg) orgName = authorOrg.name;
  else if (titleOrg) orgName = titleOrg.name;
  else if (sourceOrg) orgName = sourceOrg.name;
  else if (raw.author && ORGISH.test(raw.author) && raw.author.length <= 120) orgName = raw.author;
  const organization = orgName ? toOrgRef(orgName) : null;
  if (organization && !organization.website) {
    organization.website = findOrgWebsite(organization.name, organization.short, [applyUrl, ...allLinks(bodyHtml)]);
  }

  // Location
  const locLabel = labelled(head, LOCATION_LABELS, 160, true);
  const countryLabel = labelled(head, COUNTRY_LABELS, 120, true);
  const cityLabel = labelled(head, CITY_LABELS, 60);
  let countryCode: string | null = null;
  let city: string | null = null;
  let locationText: string | null = locLabel ?? ([cityLabel, countryLabel].filter(Boolean).join(", ") || null);

  // "Martinique (France)", "Greenland (Denmark)": the territory, not the administering country
  const fromLabels = stripAdministeringCountry([locLabel, countryLabel].filter(Boolean).join(" ; "));
  let countries = fromLabels ? findCountries(fromLabels) : [];
  if (countries.length === 0) {
    // A feed tag counts only when the whole tag is a country name ("Kenya", not "Jordan Smith").
    const tagCountries = raw.categories
      .map((c) => ({ tag: normalizeForCompare(c), found: findCountries(c) }))
      .filter(({ tag, found }) => found.length === 1 && COUNTRY_NAMES.get(tag) === found[0])
      .map(({ found }) => found[0]);
    countries = [...new Set(tagCountries)];
  }
  if (countries.length === 0) {
    for (const seg of titleTailSegments(title)) {
      const place = placeOnly(seg);
      if (place && place.countries.length) { countries = place.countries; if (!locationText) locationText = seg; break; }
    }
  }
  let knownCity: string | null = null;
  if (cityLabel || locLabel) knownCity = findCity((cityLabel ?? locLabel)!);
  else for (const seg of titleTailSegments(title)) {
    const place = placeOnly(seg);
    if (place?.city) { knownCity = place.city; if (!locationText) locationText = seg; break; }
  }
  if (cityLabel && !PLACEHOLDER_RE.test(cityLabel)) city = oneLine(cityLabel).slice(0, 80);
  else if (knownCity) city = knownCity;
  else if (locLabel && countries.length === 1) {
    // "Duty station: Kandahar, Afghanistan" → city is the part before the country
    const first = locLabel.split(/[,;/]/)[0].trim();
    if (first && findCountries(first).length === 0 && !REMOTE_RE.test(first) && first.length <= 60 && !PLACEHOLDER_RE.test(first)) city = first;
  }

  if (countries.length > 1 && countryLabel && findCountries(countryLabel).length > 1) {
    // keep the source's order ("Argentina, Bolivia, Brazil")
    const ordered = [...new Set(countryLabel.split(/[,;]/).flatMap((part) => findCountries(part)))];
    locationText = (ordered.length === countries.length ? ordered : countries).map((c) => countryByCode(c)?.name ?? c).join(", ").slice(0, 200);
  }
  if (countries.length === 1) countryCode = countries[0];
  else if (countries.length === 0 && knownCity) countryCode = DUTY_STATIONS[knownCity] ?? null;
  // several countries → keep the source's wording, no single country

  if (!locationText && knownCity) locationText = knownCity;

  // Remote
  const remoteSource = [title, locLabel, labelled(head, TYPE_LABELS, 80), ...raw.categories].filter(Boolean).join(" | ");
  const isRemote = REMOTE_RE.test(remoteSource) ? true : null;

  // Type, grade, reference
  const typeLabel = labelled(head, TYPE_LABELS, 80);
  const jobType = detectJobType([title, typeLabel ?? ""].join(" | "));
  const grade = detectGrade(title, labelled(head, GRADE_LABELS, 30));
  const refLabel = labelled(head, REF_LABELS, 40);
  const refMatch = refLabel?.match(/[A-Za-z0-9][A-Za-z0-9\-/_.]{2,39}/);
  const reference = refMatch && /\d/.test(refMatch[0]) ? refMatch[0] : null;

  // Requirements stated in the text (read even when the description itself isn't republished)
  const { required: languages, desirable: desirableLanguages } = detectLanguageRequirements(text);
  const minExperienceYears = detectExperienceYears(text);

  // Dates
  let publishedAt = parseFeedDate(raw.published) ?? parseFeedDate(raw.updated);
  if (publishedAt && publishedAt.getTime() > Date.now() + 36 * 3600_000) publishedAt = null; // future dates are not trusted
  let deadline = extractDeadline(head) ?? extractDeadline(title);
  if (deadline) {
    const ref = publishedAt ?? new Date();
    const d = new Date(`${deadline}T00:00:00Z`).getTime();
    if (d < ref.getTime() - 7 * 86400_000 || d > ref.getTime() + 400 * 86400_000) deadline = null; // implausible
  }

  // Content (only what the feed's policy allows)
  const policy = feed.contentPolicy;
  let summary: string | null = null;
  let descriptionHtml: string | null = null;
  if (policy === "excerpt" || policy === "full") {
    const plain = htmlToText(raw.summaryHtml || raw.contentHtml || "");
    summary = plain ? excerpt(plain, IMPORT_SETTINGS.excerptLength) : null;
  }
  if (policy === "full" && bodyHtml) {
    // Capped without breaking the markup (a plain slice could cut a tag in half or leave tags open).
    const cleaned = sanitizeDescriptionMax(bodyHtml, 60_000);
    descriptionHtml = cleaned.length > 20 ? cleaned : null;
  }

  const category = detectCategory(title);
  const urlHash = sha256(canonicalizeUrl(sourceUrl));

  // Fingerprint for cross-site duplicates. With a vacancy number, organization + number identifies
  // the post; otherwise title + organization + at least two of (deadline, place).
  const place = countryCode ?? (city ? normalizeForCompare(city) : null);
  const fingerprint = !organization
    ? null
    : reference
      ? sha256(["ref", organization.slug, reference.toUpperCase()].join("|"))
      : deadline && place
        ? sha256(["t", normalizeForCompare(title), organization.slug, deadline, place].join("|"))
        : null;

  const titleNorm = ` ${normalizeForCompare(title)} `;
  const extras = [organization?.short ?? organization?.name, city ?? countryByCode(countryCode)?.name]
    .filter((x): x is string => !!x && !titleNorm.includes(` ${normalizeForCompare(x)} `));
  // The slug leaves out a reference number at the start of the title (titleForSlug); old URLs still
  // work, since a job page is found by the id at the end of its URL and redirects to the current slug.
  const slugBase = [titleForSlug(title, reference), ...extras].join(" ");

  return {
    title,
    slug: slugify(slugBase, 90),
    organization,
    countryCode,
    city,
    locationText: locationText ? oneLine(locationText).slice(0, 200) : null,
    isRemote,
    category,
    jobType,
    grade,
    languages,
    desirableLanguages,
    minExperienceYears,
    reference,
    summary,
    descriptionHtml,
    contentPolicy: policy,
    applyUrl,
    applyHost,
    sourceHost,
    urlHash,
    fingerprint,
    publishedAt,
    deadline,
    guid: raw.guid,
    sourceTitle: raw.sourceTitle ? oneLine(raw.sourceTitle).slice(0, 200) : null,
  };
}
