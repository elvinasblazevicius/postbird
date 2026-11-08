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
import { IMPORT_SETTINGS } from "@/config/import";
import { escapeRegExp, excerpt, htmlToText, normalizeForCompare, oneLine, sanitizeDescription, slugify } from "@/lib/text";
import { extractDeadline, parseFeedDate } from "./dates";
import type { RawItem } from "./parse";
import { canonicalizeUrl, hostOf, pickApplyUrl, sha256 } from "./url";

export type ContentPolicy = "none" | "excerpt" | "full";

export type FeedContext = {
  id: number;
  name: string;
  defaultOrganization: string | null;
  contentPolicy: ContentPolicy;
};

export type OrgRef = { name: string; slug: string; short: string | null; type: string | null };

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
  languages: string[] | null;
  minExperienceYears: number | null;
  reference: string | null;
  summary: string | null;
  descriptionHtml: string | null;
  contentPolicy: ContentPolicy;
  applyUrl: string;
  applyHost: string;
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
  return ORG_INDEX.get(normalizeForCompare(name));
}

export function knownOrgByHost(host: string): KnownOrg | undefined {
  if (!host) return undefined;
  return KNOWN_ORGS.find((o) => o.domains?.some((d) => host === d || host.endsWith(`.${d}`)));
}

function toOrgRef(name: string): OrgRef {
  const known =
    knownOrgByName(name) ??
    name.split(/\s[-–—|]\s|\(|\)|,/).map((p) => knownOrgByName(p)).find(Boolean);
  if (known) return { name: known.name, slug: slugify(known.short && known.short.length <= 12 ? known.short : known.name, 60), short: known.short ?? null, type: known.type };
  const clean = oneLine(name).slice(0, 120);
  return { name: clean, slug: slugify(clean, 60), short: null, type: null };
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

const GRADE_RE = /\b(USG|ASG|D-?[12]|P-?[1-7]|NO-?[A-E]|G-?[1-7]|GS-?[1-7]|FS-?[1-7]|SB-?[1-5]|LICA-?\d{1,2}|NPSA-?\d{1,2}|IPSA-?\d{1,2}|ICS-?\d{1,2})\b/;

function normalizeGrade(g: string): string {
  const m = g.toUpperCase().match(/^(USG|ASG|NO|GS|FS|SB|LICA|NPSA|IPSA|ICS|D|P|G)-?(\w+)$/);
  if (!m) return g.toUpperCase();
  if (m[1] === "USG" || m[1] === "ASG") return m[1];
  return `${m[1]}-${m[2]}`;
}

export function detectJobType(text: string): string | null {
  const t = text.toLowerCase();
  if (/\binterns?(hip)?\b|\bstagiaire\b|\bpasant[ií]a\b/.test(t)) return "Internship";
  if (/\bfellow(ship)?s?\b/.test(t)) return "Fellowship";
  if (/\b(un )?volunteers?\b|\bunv\b/.test(t)) return "Volunteer";
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

const LANGUAGE_NAMES = ["French", "Spanish", "Arabic", "Portuguese", "Russian", "Chinese"];
const LANG_CONTEXT = /\b(fluen\w*|proficien\w*|knowledge of|command of|language|languages|written and (?:oral|spoken)|spoken and written|oral and written|bilingual)\b/i;

/** Languages (other than English) named in a sentence about language requirements. */
export function detectLanguages(text: string): string[] | null {
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.;:!?])\s+|\n/)) {
    if (sentence.length > 600 || !LANG_CONTEXT.test(sentence)) continue;
    for (const lang of LANGUAGE_NAMES) {
      // "French" but not "French Polynesia" / "Spanish-speaking"-style adjectives are still fine
      if (new RegExp(`\\b${lang}\\b(?! Polynesia| Guiana| Southern)`, "i").test(sentence)) found.add(lang);
    }
  }
  return found.size ? [...found].sort() : null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/** Minimum years of experience from phrases like "a minimum of five (5) years of ... experience". */
export function detectExperienceYears(text: string): number | null {
  const re = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)(?:\s*\(\d{1,2}\))?\s*\+?\s*(?:or more\s+)?years?\b[^.\n]{0,80}?\bexperience\b/i;
  const m = text.match(re);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  return n !== undefined && n >= 0 && n <= 30 ? n : null;
}

const REMOTE_RE = /\b(remote|home[- ]?based|work from home|working from home|telework(ing)?|telecommut(e|ing)|t[ée]l[ée]travail|teletrabajo)\b/i;

/** Split a title into trailing segments that may hold a location, e.g. "Analyst - Nairobi, Kenya". */
function titleTailSegments(title: string): string[] {
  const parts = title.split(/\s[-–—|]\s|\s\/\s|\(|\)/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts.slice(1) : [];
}

// ── Main ─────────────────────────────────────────────────────

export function normalizeItem(raw: RawItem, feed: FeedContext): NormalizedJob {
  const title = oneLine(raw.title).slice(0, 300);
  if (!title) throw new ItemSkipped("Item has no title");

  const applyUrl = pickApplyUrl(raw.links);
  if (!applyUrl) throw new ItemSkipped("Item has no link to the original vacancy");
  const applyHost = hostOf(applyUrl);

  const bodyHtml = raw.contentHtml || raw.summaryHtml || "";
  const text = htmlToText(bodyHtml);
  const head = text.slice(0, 4000); // labelled facts sit near the top

  // Organization
  let orgName: string | null = null;
  const labelledOrg = labelled(head, ORG_LABELS, 120);
  const hostOrg = knownOrgByHost(applyHost);
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

  // Location
  const locLabel = labelled(head, LOCATION_LABELS, 160, true);
  const countryLabel = labelled(head, COUNTRY_LABELS, 120, true);
  const cityLabel = labelled(head, CITY_LABELS, 60);
  let countryCode: string | null = null;
  let city: string | null = null;
  let locationText: string | null = locLabel ?? ([cityLabel, countryLabel].filter(Boolean).join(", ") || null);

  const fromLabels = [locLabel, countryLabel].filter(Boolean).join(" ; ");
  let countries = fromLabels ? findCountries(fromLabels) : [];
  if (countries.length === 0) {
    const tagCountries = raw.categories
      .filter((c) => normalizeForCompare(c).split(" ").length <= 5)
      .map((c) => findCountries(c))
      .filter((found) => found.length === 1)
      .map((found) => found[0]);
    countries = [...new Set(tagCountries)];
  }
  if (countries.length === 0) {
    for (const seg of titleTailSegments(title)) {
      const c = findCountries(seg);
      if (c.length) { countries = c; if (!locationText) locationText = seg; break; }
    }
  }
  const cityFrom = cityLabel ?? locLabel ?? titleTailSegments(title).join(" ; ");
  const knownCity = cityFrom ? findCity(cityFrom) : null;
  if (cityLabel) city = oneLine(cityLabel).slice(0, 80);
  else if (knownCity) city = knownCity;
  else if (locLabel && countries.length === 1) {
    // "Duty station: Kandahar, Afghanistan" → city is the part before the country
    const first = locLabel.split(/[,;/]/)[0].trim();
    if (first && findCountries(first).length === 0 && !REMOTE_RE.test(first) && first.length <= 60 && !/multiple|various|several|tbd|any/i.test(first)) city = first;
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
  const gradeLabel = labelled(head, GRADE_LABELS, 30);
  const gradeMatch = (gradeLabel && gradeLabel.match(GRADE_RE)) || title.match(GRADE_RE);
  const grade = gradeMatch ? normalizeGrade(gradeMatch[1]) : null;
  const refLabel = labelled(head, REF_LABELS, 40);
  const refMatch = refLabel?.match(/[A-Za-z0-9][A-Za-z0-9\-/_.]{2,39}/);
  const reference = refMatch && /\d/.test(refMatch[0]) ? refMatch[0] : null;

  // Requirements stated in the text (read even when the description itself isn't republished)
  const languages = detectLanguages(text);
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
    const cleaned = sanitizeDescription(bodyHtml);
    descriptionHtml = cleaned.length > 20 ? cleaned.slice(0, 60_000) : null;
  }

  const category = detectCategory(title);
  const urlHash = sha256(canonicalizeUrl(applyUrl));

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
  const slugBase = [title, ...extras].join(" ");

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
    minExperienceYears,
    reference,
    summary,
    descriptionHtml,
    contentPolicy: policy,
    applyUrl,
    applyHost,
    urlHash,
    fingerprint,
    publishedAt,
    deadline,
    guid: raw.guid,
    sourceTitle: raw.sourceTitle ? oneLine(raw.sourceTitle).slice(0, 200) : null,
  };
}
