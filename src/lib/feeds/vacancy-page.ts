/**
 * Facts from the employer's own vacancy page: closing date, place, contract type, grade,
 * experience and languages, for jobs whose feed item left them out. Three readers, best first:
 *  1. a recruitment system's public job data, for systems whose pages are built in the browser
 *     (Oracle Recruiting Cloud, e.g. IOM; SmartRecruiters, e.g. OECD; Workday);
 *  2. the schema.org JobPosting record many careers pages carry for search engines;
 *  3. labelled facts in the page's main text ("Closing date: …", "Duty station: …"), read by the
 *     same rules as feed items (normalizeItem).
 * Facts only: no wording from the page is stored. The caller fetches (robots.txt, pacing).
 */
import { extractDeadline } from "./dates";
import { countryByCode } from "@/config/countries";
import { htmlToText } from "@/lib/text";
import { detectExperienceYears, detectJobType, detectLanguageRequirements, findCity, findCountries, normalizeItem } from "./extract";

export type PageFacts = {
  deadline: string | null;
  countryCode: string | null;
  city: string | null;
  locationText: string | null;
  jobType: string | null;
  grade: string | null;
  experienceYears: number | null;
  languages: string[] | null;
  via: "oracle" | "smartrecruiters" | "workday" | "jsonld" | "taleo" | "text";
};

export const EMPTY_FACTS: Omit<PageFacts, "via"> = {
  deadline: null, countryCode: null, city: null, locationText: null, jobType: null, grade: null, experienceYears: null, languages: null,
};

export function hasFacts(f: Partial<PageFacts> | null | undefined): boolean {
  return !!f && !!(f.deadline || f.countryCode || f.locationText || f.jobType || f.grade || f.experienceYears || f.languages?.length);
}

// ── Recruitment systems with public job data ─────────────────

/** Oracle Recruiting Cloud: …/hcmUI/CandidateExperience/en/sites/CX_1001/job/24002 → its job-details API. */
export function oracleApiUrl(url: string): string | null {
  const m = url.match(/^https:\/\/([a-z0-9.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_]+)\/(?:requisitions\/preview|job)\/(\d+)/i);
  if (!m) return null;
  return `https://${m[1]}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${m[3]}%22,siteNumber=${m[2]}`;
}

/** SmartRecruiters: jobs.smartrecruiters.com/OECD/744000159633919-auditeur-interne → its public postings API. */
export function smartRecruitersApiUrl(url: string): string | null {
  const m = url.match(/^https:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)\/(\d{6,})/i);
  return m ? `https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}` : null;
}

/** Workday: tenant.wd3.myworkdayjobs.com/[en-US/]Site/job/Place/Title_R123 → its public job API. */
export function workdayApiUrl(url: string): string | null {
  const m = url.match(/^https:\/\/(([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/([^?#]+)/i);
  return m ? `https://${m[1]}/wday/cxs/${m[2]}/${m[3]}/job/${m[4]}` : null;
}

export function systemApiUrl(url: string): { api: string; via: "oracle" | "smartrecruiters" | "workday" } | null {
  const o = oracleApiUrl(url);
  if (o) return { api: o, via: "oracle" };
  const s = smartRecruitersApiUrl(url);
  if (s) return { api: s, via: "smartrecruiters" };
  const w = workdayApiUrl(url);
  if (w) return { api: w, via: "workday" };
  return null;
}

function dateOnly(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function countryOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v) && countryByCode(v.toUpperCase())) return v.toUpperCase();
  const found = findCountries(v);
  return found.length === 1 ? found[0] : null;
}

/** Facts from text the system gives (a description): labelled experience and languages only. */
function textFacts(html: string | null | undefined) {
  const text = htmlToText(html ?? "");
  if (!text) return { experienceYears: null, languages: null };
  const langs = detectLanguageRequirements(text).required;
  return { experienceYears: detectExperienceYears(text), languages: langs?.length ? langs : null };
}

export function factsFromSystem(via: "oracle" | "smartrecruiters" | "workday", data: unknown): PageFacts | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (via === "oracle") {
    const it = (Array.isArray(d.items) ? d.items[0] : null) as Record<string, unknown> | null;
    if (!it) return null;
    const place = typeof it.PrimaryLocation === "string" ? it.PrimaryLocation : null;
    const code = countryOf(it.PrimaryLocationCountry) ?? (place ? countryOf(place.split(",").pop()) : null);
    const description = [it.ExternalDescriptionStr, it.ExternalQualificationsStr, it.ExternalResponsibilitiesStr].filter((x) => typeof x === "string").join("\n");
    return {
      ...EMPTY_FACTS,
      deadline: dateOnly(it.ExternalPostedEndDate),
      countryCode: code,
      city: place && place.includes(",") ? place.split(",")[0].trim() || null : null,
      locationText: place,
      jobType: detectJobType([it.ContractType, it.JobType, it.WorkerType, it.JobSchedule].filter((x) => typeof x === "string").join(" | ")),
      ...textFacts(description),
      via,
    };
  }
  if (via === "smartrecruiters") {
    const loc = (d.location ?? {}) as Record<string, unknown>;
    const ad = (d.jobAd ?? {}) as { sections?: Record<string, { text?: string }> };
    const description = Object.values(ad.sections ?? {}).map((s) => s?.text ?? "").join("\n");
    return {
      ...EMPTY_FACTS,
      countryCode: countryOf(loc.country),
      city: typeof loc.city === "string" ? loc.city : null,
      locationText: typeof loc.fullLocation === "string" ? loc.fullLocation : null,
      jobType: detectJobType(String((d.typeOfEmployment as { label?: string } | undefined)?.label ?? "")),
      ...textFacts(description),
      via,
    };
  }
  const info = (d.jobPostingInfo ?? null) as Record<string, unknown> | null;
  if (!info) return null;
  const place = typeof info.location === "string" ? info.location : null;
  return {
    ...EMPTY_FACTS,
    deadline: dateOnly(info.endDate),
    countryCode: countryOf((info.country as { descriptor?: string } | undefined)?.descriptor) ?? (place ? countryOf(place) : null),
    city: place ? findCity(place) : null,
    locationText: place,
    jobType: detectJobType(String(info.timeType ?? "")),
    ...textFacts(typeof info.jobDescription === "string" ? info.jobDescription : null),
    via,
  };
}

// ── schema.org JobPosting ────────────────────────────────────

function* jsonLdObjects(html: string): Generator<Record<string, unknown>> {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    // Some systems capitalise the property names ("ValidThrough", "JobLocation"): read them as schema.org writes them.
    try { data = JSON.parse(m[1].trim(), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [/^[A-Z][a-z]/.test(k) ? k[0].toLowerCase() + k.slice(1) : k, x])) : v)); } catch { continue; }
    const stack: unknown[] = [data];
    while (stack.length) {
      const x = stack.pop();
      if (Array.isArray(x)) stack.push(...x);
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        yield o;
        if (o["@graph"]) stack.push(o["@graph"]);
      }
    }
  }
}

const EMPLOYMENT_TYPES: Record<string, string> = {
  TEMPORARY: "Temporary", INTERN: "Internship", VOLUNTEER: "Volunteer", PART_TIME: "Part-time", CONTRACTOR: "Consultancy",
};

export function factsFromJobPosting(html: string): PageFacts | null {
  for (const o of jsonLdObjects(html)) {
    const type = o["@type"];
    if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) continue;
    const locs = ([] as unknown[]).concat(o.jobLocation ?? []);
    const addr = ((locs[0] as { address?: unknown } | undefined)?.address ?? {}) as Record<string, unknown>;
    const addrCountry = typeof addr.addressCountry === "object" ? (addr.addressCountry as { name?: string })?.name : addr.addressCountry;
    const city = typeof addr.addressLocality === "string" ? addr.addressLocality.trim() || null : null;
    const countryCode = countryOf(addrCountry) ?? (city ? countryOf(city) : null);
    const countryName = countryCode ? countryByCode(countryCode)?.name ?? null : null;
    const types = ([] as unknown[]).concat(o.employmentType ?? []).map((t) => String(t).toUpperCase());
    const remote = String(o.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE";
    const description = typeof o.description === "string" ? o.description : null;
    return {
      ...EMPTY_FACTS,
      deadline: dateOnly(o.validThrough),
      countryCode,
      city,
      locationText: [city, countryName].filter(Boolean).join(", ") || (remote ? "Remote" : null),
      jobType: types.map((t) => EMPLOYMENT_TYPES[t]).find(Boolean) ?? null,
      ...textFacts(description),
      via: "jsonld",
    };
  }
  return null;
}

// ── Labelled facts in the page text ──────────────────────────

/** The page's main content: without scripts, styles, navigation, header, footer, side bars and forms. */
export function mainContentHtml(html: string): string {
  let h = html.replace(/<(script|style|noscript|template|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? h.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  if (main) h = main;
  else h = h.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? h;
  return h.slice(0, 200_000);
}

export function factsFromText(title: string, url: string, html: string): PageFacts | null {
  try {
    const main = mainContentHtml(html);
    const j = normalizeItem(
      { guid: null, title, links: [url], summaryHtml: null, contentHtml: main, published: null, updated: null, author: null, categories: [], sourceTitle: null, sourceUrl: null },
      { id: 0, name: "vacancy page", defaultOrganization: null, contentPolicy: "none" },
    );
    return {
      deadline: j.deadline ?? labelledDeadlineAnywhere(main, html), countryCode: j.countryCode, city: j.city, locationText: j.locationText,
      jobType: j.jobType, grade: j.grade, experienceYears: j.minExperienceYears, languages: j.languages?.length ? j.languages : null,
      via: "text",
    };
  } catch {
    return null;
  }
}

/**
 * A labelled closing date further down the page than the import looks in a feed item, or in a
 * part of the page outside its main content (a side panel with "Application deadline", a header
 * with "Closing at"). Still only a date that follows a closing-date label.
 */
function labelledDeadlineAnywhere(main: string, html: string): string | null {
  const text = (h: string) => h.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  return plausibleDeadline(extractDeadline(text(main))) ?? plausibleDeadline(extractDeadline(text(html.slice(0, 600_000))));
}

/** How far ahead a JobPosting record's "valid through" date is believed: beyond this it is usually the recruitment system's own expiry, not the closing date. */
const VALID_THROUGH_MAX_DAYS = 75;

function believableValidThrough(d: string | null, today = new Date()): string | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`).getTime();
  return Number.isNaN(t) || t > today.getTime() + VALID_THROUGH_MAX_DAYS * 86400_000 ? null : d;
}

/**
 * JobPosting first, then labelled text for whatever the record left out. The closing date is the
 * other way round: a date the page labels as its closing date wins over the record's "valid
 * through", which many recruitment systems fill with their own expiry (90 days, a year).
 */
/**
 * Taleo vacancy pages (FAO, WHO, IAEA, NATO…) draw their fields with JavaScript from one hidden
 * value, "initialHistory": the fields in order, separated by "!|!" ("13/Nov/2026", "04/Dec/2026,
 * 11:59:00 PM", "P-3", "Italy-Rome", then the description). The values are read by their shape:
 * the latest date after the posting date is the closing date, a grade code is the grade, and
 * "Country-City" is the duty station. Null when the page isn't a Taleo page.
 */
export function taleoText(html: string): string | null {
  const raw = html.match(/id="initialHistory"[^>]*value="([^"]*)"/)?.[1] ?? html.match(/value="([^"]*)"[^>]*id="initialHistory"/)?.[1];
  if (!raw) return null;
  // Decoded leniently: a stray "%" in the text must not lose the whole page.
  const decoded = raw.replace(/&amp;/g, "&").replace(/(?:%[0-9A-Fa-f]{2})+/g, (seq) => { try { return decodeURIComponent(seq); } catch { return seq; } });
  const parts = decoded.split("!|!").map((p) => p.replace(/\\(.)/g, "$1").replace(/^!\*!/, "").trim()).filter(Boolean);
  const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const dateOf = (p: string): string | null => {
    let m = p.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})/); // 04/Dec/2026
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = p.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})/); // Dec 3, 2026
    if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null;
  };
  const dates = [...new Set(parts.map(dateOf).filter((d): d is string => Boolean(d)))].sort();
  const closing = dates.length >= 2 ? dates[dates.length - 1] : null;
  const grade = parts.find((p) => /^(?:P|D|G|GS|NO[A-D]?|FS|NPSA|IPSA|ICS|SB|LICA|IICA|A|B|C)-?\d{1,2}$/.test(p) && /\d/.test(p));
  const place = parts.find((p) => /^[A-Z][\p{L} .'(),]{2,40}-[A-Z][\p{L} .'-]{1,40}$/u.test(p));
  // No "Country-City" ("Various Locations"): the office the post belongs to names the country ("FAO Representation in Georgia").
  const office = place ? null : parts.map((p) => p.match(/(?:Representation|Country Office|Office) (?:in|for) (?:the )?([A-Z][\p{L} .'-]{2,40})$/u)?.[1]).find(Boolean);
  const description = parts.filter((p) => p.length > 200 && /<[a-z]/i.test(p)).sort((a, b) => b.length - a.length)[0] ?? "";
  const facts = [
    closing ? `<p>Closing date: ${closing}</p>` : "",
    grade ? `<p>Grade: ${grade}</p>` : "",
    place ? `<p>Duty station: ${place.replace(/^(.+?)-(.+)$/, "$2, $1")}</p>` : office ? `<p>Country: ${office}</p>` : "",
  ].join("");
  return facts || description ? `${facts}${description}` : null;
}

export function factsFromPage(title: string, url: string, html: string): PageFacts | null {
  const taleo = taleoText(html);
  if (taleo) {
    const t = factsFromText(title, url, `<main>${taleo}</main>`);
    if (hasFacts(t)) return { ...t!, via: "taleo" };
  }
  const ld = factsFromJobPosting(html);
  const text = factsFromText(title, url, html);
  if (!ld) return hasFacts(text) ? text : null;
  const ldDeadline = believableValidThrough(ld.deadline);
  if (!text) return hasFacts({ ...ld, deadline: ldDeadline }) ? { ...ld, deadline: ldDeadline } : null;
  const place = ld.countryCode || ld.locationText ? ld : text;
  const merged: PageFacts = {
    deadline: text.deadline ?? ldDeadline,
    countryCode: place.countryCode, city: place.city, locationText: place.locationText,
    jobType: ld.jobType ?? text.jobType,
    grade: ld.grade ?? text.grade,
    experienceYears: ld.experienceYears ?? text.experienceYears,
    languages: ld.languages ?? text.languages,
    via: "jsonld",
  };
  return hasFacts(merged) ? merged : null;
}

/** A closing date only when plausible: not long past, not more than about a year ahead. */
export function plausibleDeadline(d: string | null, today = new Date()): string | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return null;
  const now = today.getTime();
  return t < now - 7 * 86400_000 || t > now + 400 * 86400_000 ? null : d;
}

// ── Still open? ──────────────────────────────────────────────

/**
 * Wording employers use once a vacancy is closed. Read only in the page's main content, so a
 * "closed vacancies" menu link or footer doesn't count.
 */
const CLOSED_RE =
  /\b(?:no longer (?:accepting|available|open|active|exists?)|(?:position|vacancy|job|posting|post|role|opening) (?:has been|is|was) (?:filled|closed|withdrawn|cancell?ed|removed|expired)|(?:this|the) (?:job|position|vacancy|posting|offer|role) (?:is|has) (?:expired|closed|ended)|applications? (?:are|is) (?:now )?closed|(?:job|vacancy|posting) (?:has )?expired|deadline (?:for applications )?has passed|job (?:not found|could not be found)|the (?:job|page) you (?:are|were) looking for (?:is|was|could) (?:no longer|not))/i;

export function pageSaysClosed(html: string): boolean {
  return CLOSED_RE.test(htmlToText(mainContentHtml(html)).slice(0, 6000));
}

/** A recruitment system's answer for one job: "closed" only when the system says so plainly. */
export function systemSaysClosed(via: "oracle" | "smartrecruiters" | "workday", data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (via === "smartrecruiters") return d.active === false;
  if (via === "oracle") return Array.isArray(d.items) && d.items.length === 0;
  return false;
}
