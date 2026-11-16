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
  via: SystemVia | "jsonld" | "taleo" | "microdata" | "pagedata" | "text";
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
  const m = url.match(/^https:\/\/([a-z0-9.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_]+)\/(?:requisitions\/(?:preview|job)|job)\/(\d+)/i);
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

/** UN Careers (careers.un.org/jobSearchDescription/288425) → the public job-opening data its page loads. */
export function unCareersApiUrl(url: string): string | null {
  const m = url.match(/^https:\/\/careers\.un\.org\/jobSearchDescription\/(\d+)/i);
  return m ? `https://careers.un.org/api/public/opening/jo/${m[1]}/en` : null;
}

export type SystemVia = "oracle" | "smartrecruiters" | "workday" | "uncareers";

export function systemApiUrl(url: string): { api: string; via: SystemVia } | null {
  const u = unCareersApiUrl(url);
  if (u) return { api: u, via: "uncareers" };
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

/** The calendar day of an instant in New York (UN closing times are 23:59 New York, stored as 04:59 UTC the next day). */
function newYorkDay(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

export function factsFromSystem(via: SystemVia, data: unknown): PageFacts | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (via === "uncareers") {
    // Read as labelled text, so duty stations ("GENEVA"), grades and contract types go through the same rules as any page.
    const it = (d.data ?? null) as Record<string, unknown> | null;
    if (!it) return null;
    const stations = (Array.isArray(it.dutyStation) ? it.dutyStation : []).map((x) => String((x as { description?: string })?.description ?? "").trim()).filter(Boolean);
    const station = stations.length === 1 ? stations[0].toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : null;
    const closing = newYorkDay(it.endDate);
    const html = [
      closing ? `<p>Closing date: ${closing}</p>` : "",
      station ? `<p>Duty station: ${station}</p>` : "",
      typeof it.jobLevel === "string" && it.jobLevel ? `<p>Grade: ${it.jobLevel}</p>` : "",
      typeof it.recrTypeDescription === "string" && it.recrTypeDescription ? `<p>Contract type: ${it.recrTypeDescription}</p>` : "",
      typeof it.jobDescription === "string" ? it.jobDescription : "",
    ].join("");
    const f = factsFromText(String(it.jobTitle ?? ""), "https://careers.un.org/", `<main>${html}</main>`);
    return f ? { ...f, deadline: closing ?? f.deadline, via } : null;
  }
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
    m = p.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/); // 18-Nov-2026, 5:59:00 PM
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = p.match(/^(\d{4})-(\d{2})-(\d{2})(?:,|\s|$)/); // 2026-11-27, 11:59:00 PM
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  };
  // Taleo shows times in a time zone that varies between requests: "23:59 Vienna" can come back as
  // "00:59 AM" the next day. A time before 5 AM is taken as the evening before.
  const dayOf = (p: string): string | null => {
    const d = dateOf(p);
    const t = p.match(/,\s*(\d{1,2}):\d{2}(?::\d{2})?\s*(AM|PM)?/i);
    if (!d || !t) return d;
    const h = Number(t[1]) % 12 + (t[2]?.toUpperCase() === "PM" ? 12 : t[2] ? 0 : Number(t[1]) >= 12 ? 12 : 0);
    if (h >= 5) return d;
    const prev = new Date(`${d}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  };
  const dates = [...new Set(parts.map(dayOf).filter((d): d is string => Boolean(d)))].sort();
  // The latest of two or more dates (posted, closing), or a lone date still ahead (pages that show only the closing date).
  const today = new Date().toISOString().slice(0, 10);
  const closing = dates.length >= 2 ? dates[dates.length - 1] : dates.length === 1 && dates[0] >= today ? dates[0] : null;
  const grade = parts.find((p) => /^(?:P|D|G|GS|NO[A-D]?|FS|NPSA|IPSA|ICS|SB|LICA|IICA|A|B|C)-?\d{1,2}$/.test(p) && /\d/.test(p))
    ?? parts.map((p) => p.match(/^NATO Grade ([A-Z]\d{1,2})$/)?.[1]).find(Boolean);
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

/** A date written by a system in almost any machine format ("2026-11-30T20:59:00+00:00", "Wed Nov 18 06:00:00 UTC 2026"). */
function anyDate(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const iso = typeof v === "string" ? v.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] : null;
  if (iso) return iso;
  const t = new Date(typeof v === "number" && v < 1e11 ? v * 1000 : v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/**
 * schema.org written into the page's tags instead of a script ("microdata"): <meta itemprop="validThrough"
 * content="Wed Nov 18 06:00:00 UTC 2026">, itemprop="addressCountry", itemprop="addressLocality".
 */
export function factsFromMicrodata(html: string): PageFacts | null {
  const prop = (name: string): string | null => {
    const tag = html.match(new RegExp(`<[^>]+itemprop=["']${name}["'][^>]*>`, "i"))?.[0];
    if (!tag) return null;
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) return content.trim();
    const after = html.slice(html.indexOf(tag) + tag.length, html.indexOf(tag) + tag.length + 200).match(/^([^<]{1,120})</)?.[1];
    return after?.trim() || null;
  };
  const deadline = anyDate(prop("validThrough"));
  const city = prop("addressLocality");
  const countryCode = countryOf(prop("addressCountry")) ?? (city ? countryOf(city) : null);
  const facts: PageFacts = { ...EMPTY_FACTS, deadline, countryCode, city: countryCode ? city : null, locationText: countryCode ? [city, countryByCode(countryCode)?.name].filter(Boolean).join(", ") : null, via: "microdata" };
  return hasFacts(facts) ? facts : null;
}

/** Keys that name a posting's closing date in page data (never a plain "endDate", which is often the contract's). */
const CLOSING_KEY = /^(?:posting)?(?:expir(?:y|ation|es)|closing|close|deadline|applicationDeadline|applyBy|validThrough|postingEnd|jobPostingEnd|postingClose|applicationClose|applicationEnd)(?:Date|DateTime|Timestamp|TimestampUTC|Utc|At|On)?$/i;
const COUNTRY_KEY = /^(?:iso)?(?:countryCode|country|addressCountry|isoCountryCode)$/i;
const CITY_KEY = /^(?:city|cityName|locality|addressLocality|town)$/i;

/**
 * The job's data that script-built pages embed for themselves (Next.js "__NEXT_DATA__", other
 * application/json blocks): a closing date under a closing-date key, and a country and town under a
 * location key. Works for any system built this way, known or not. Texts for the page's own
 * interface (translations) are skipped.
 */
export function factsFromPageData(html: string): PageFacts | null {
  let deadline: string | null = null, countryCode: string | null = null, city: string | null = null;
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].length > 3_000_000) continue;
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const stack: { v: unknown; path: string }[] = [{ v: data, path: "" }];
    let seen = 0;
    while (stack.length && seen++ < 200_000) {
      const { v, path } = stack.pop()!;
      if (Array.isArray(v)) { v.slice(0, 50).forEach((x, i) => stack.push({ v: x, path: `${path}[${i}]` })); continue; }
      if (!v || typeof v !== "object") continue;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const p = `${path}.${k}`;
        if (/i18n|translation|locale[s]?\b|messages/i.test(p)) continue;
        if (x && typeof x === "object") { stack.push({ v: x, path: p }); continue; }
        if (!deadline && CLOSING_KEY.test(k)) deadline = plausibleDeadline(anyDate(x));
        if (/location|address|place|site/i.test(path)) {
          if (!countryCode && COUNTRY_KEY.test(k)) countryCode = countryOf(x);
          if (!city && CITY_KEY.test(k) && typeof x === "string" && x.trim().length < 60) city = x.trim();
        }
      }
    }
  }
  const facts: PageFacts = { ...EMPTY_FACTS, deadline, countryCode, city: countryCode ? city : null, locationText: countryCode ? [city, countryByCode(countryCode)?.name].filter(Boolean).join(", ") : null, via: "pagedata" };
  return hasFacts(facts) ? facts : null;
}

export function factsFromPage(title: string, url: string, html: string): PageFacts | null {
  const best = factsFromPageCore(title, url, html);
  // Whatever the main readers left empty, from schema.org tags and the page's own embedded data.
  const extra = [factsFromMicrodata(html), factsFromPageData(html)].filter((f): f is PageFacts => Boolean(f));
  if (!extra.length) return best;
  const out: PageFacts = best ? { ...best } : { ...EMPTY_FACTS, via: extra[0].via };
  for (const f of extra) {
    if (!out.deadline) out.deadline = believableValidThrough(f.deadline);
    if (!out.countryCode && !out.locationText && (f.countryCode || f.locationText)) { out.countryCode = f.countryCode; out.city = f.city; out.locationText = f.locationText; }
  }
  return hasFacts(out) ? out : best;
}

function factsFromPageCore(title: string, url: string, html: string): PageFacts | null {
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
export function systemSaysClosed(via: SystemVia, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (via === "smartrecruiters") return d.active === false;
  if (via === "oracle") return Array.isArray(d.items) && d.items.length === 0;
  return false;
}
