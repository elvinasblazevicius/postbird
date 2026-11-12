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
  via: "oracle" | "smartrecruiters" | "workday" | "jsonld" | "text";
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
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
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
    const j = normalizeItem(
      { guid: null, title, links: [url], summaryHtml: null, contentHtml: mainContentHtml(html), published: null, updated: null, author: null, categories: [], sourceTitle: null, sourceUrl: null },
      { id: 0, name: "vacancy page", defaultOrganization: null, contentPolicy: "none" },
    );
    return {
      deadline: j.deadline, countryCode: j.countryCode, city: j.city, locationText: j.locationText,
      jobType: j.jobType, grade: j.grade, experienceYears: j.minExperienceYears, languages: j.languages?.length ? j.languages : null,
      via: "text",
    };
  } catch {
    return null;
  }
}

/** JobPosting first, then labelled text for whatever the record left out. */
export function factsFromPage(title: string, url: string, html: string): PageFacts | null {
  const ld = factsFromJobPosting(html);
  const text = factsFromText(title, url, html);
  if (!ld) return hasFacts(text) ? text : null;
  if (!text) return hasFacts(ld) ? ld : null;
  const place = ld.countryCode || ld.locationText ? ld : text;
  const merged: PageFacts = {
    deadline: ld.deadline ?? text.deadline,
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
