import siteConfig from "@site-config";
import { categoryBySlug } from "@/config/categories";
import { countryByCode } from "@/config/countries";
import { LISTING_SETTINGS } from "@/config/import";
import { KNOWN_ORGS, type KnownOrg } from "@/config/organizations";

/** Shown for a detail our source doesn't give (it may still be on the employer's page). */
export const NOT_SPECIFIED = "Not in our source";

/** The one-line non-affiliation notice under the header intro of the ad landing pages (/alerts, /jobs, /grades). */
export const INDEPENDENCE_NOTE = `${siteConfig.name} is independent and not affiliated with the UN, the EU or any employer listed. Applications are made on each employer's own website.`;

/**
 * Public base URL: NEXT_PUBLIC_SITE_URL → site.config.ts → Netlify/Vercel
 * address → localhost. The environment variable wins so a test run, preview
 * or the scheduled job (SITE_URL secret) can point links elsewhere without a
 * code change.
 */
export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const fromConfig = siteConfig.url?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  // Netlify sets URL to the site's main address (custom domain or *.netlify.app).
  const netlify = process.env.NETLIFY ? process.env.URL : undefined;
  const url = fromEnv || fromConfig || netlify || (vercel ? `https://${vercel}` : `http://localhost:${process.env.PORT || 3000}`);
  return url.replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function jobPath(job: { id: number; slug: string }): string {
  return `/jobs/${job.slug}-${job.id}`;
}

/**
 * A database id from a form field or query string: 1 to 12 digits, above 0,
 * else null. Longer numbers would overflow bigint (or lose precision) and
 * make the query fail with a 500 instead of a clean "not found".
 */
export function parseId(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{1,12}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

/** Extract the numeric id from "/jobs/<slug>-<id>". */
export function parseJobParam(param: string): number | null {
  const m = param.match(/-(\d{1,12})$/) ?? param.match(/^(\d{1,12})$/);
  return m ? Number(m[1]) : null;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return NOT_SPECIFIED;
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return Number.isNaN(date.getTime()) ? NOT_SPECIFIED : dateFmt.format(date);
}

const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "12 Nov" for dates in the current year, "12 Jan 2027" otherwise. */
export function formatShortDate(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return NOT_SPECIFIED;
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  if (Number.isNaN(date.getTime())) return NOT_SPECIFIED;
  return date.getUTCFullYear() === now.getUTCFullYear() ? shortFmt.format(date) : dateFmt.format(date);
}

export function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((new Date(`${deadline}T00:00:00Z`).getTime() - today) / 86_400_000);
}

export function deadlineLabel(deadline: string | null): { text: string; urgent: boolean } | null {
  const n = daysUntil(deadline);
  if (n === null) return null;
  if (n < 0) return { text: "Closed", urgent: false };
  if (n === 0) return { text: "Closes today", urgent: true };
  if (n === 1) return { text: "Closes tomorrow", urgent: true };
  return { text: n <= 60 ? `Closes in ${n} days` : `Closes ${formatDate(deadline)}`, urgent: n <= LISTING_SETTINGS.closingSoonDays };
}

/** "in 5 days", "today", "tomorrow" for open jobs closing within 60 days; null otherwise. */
export function relativeDeadline(deadline: string | null): { text: string; urgent: boolean } | null {
  const l = deadlineLabel(deadline);
  if (!l || l.text === "Closed" || !/^Closes (in \d|today|tomorrow)/.test(l.text)) return null;
  return { text: l.text.replace(/^Closes /, ""), urgent: l.urgent };
}

export function postedLabel(published: Date | null, firstSeen: Date): string {
  const d = published ?? firstSeen;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  if (days < 30) return `Posted ${days} days ago`;
  return `Posted ${formatDate(d)}`;
}

export function locationLabel(j: { city: string | null; country_code: string | null; location_text: string | null; is_remote: boolean | null }): string {
  const country = countryByCode(j.country_code)?.name;
  const parts = [j.city, country].filter(Boolean) as string[];
  if (parts.length) {
    // avoid "Geneva, Switzerland" turning into "Switzerland, Switzerland"
    return [...new Set(parts)].join(", ");
  }
  // A long place line with an explanation in brackets ("Nairobi (Kenya or Lagos, Nigeria. Candidates must …)"): the place only.
  if (j.location_text) return j.location_text.length > 40 ? j.location_text.replace(/\s*[(.].*$/, "").trim() || j.location_text : j.location_text;
  if (j.is_remote) return "Remote";
  return NOT_SPECIFIED;
}

export function categoryName(slug: string): string {
  return categoryBySlug(slug)?.name ?? "Other";
}

/** Known organizations by every folded name, short name and alias (for their badge text). */
const KNOWN_BY_NAME = new Map<string, KnownOrg>();
const foldName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
for (const o of KNOWN_ORGS) for (const n of [o.name, o.short, ...(o.aliases ?? [])]) if (n && !KNOWN_BY_NAME.has(foldName(n))) KNOWN_BY_NAME.set(foldName(n), o);

/**
 * Short text badge for an organization: every organization gets a monogram in the same frame,
 * never a logo, so the badges don't suggest an organization endorses the site. The text comes
 * from the known-organizations list where the organization is in it ("MSF" for Médecins Sans
 * Frontières even when the stored record has no short name), otherwise from the stored short
 * name, otherwise from the initials of the name.
 */
export function monogram(name: string | null, short: string | null): string {
  const known = KNOWN_BY_NAME.get(foldName(name ?? "")) ?? KNOWN_BY_NAME.get(foldName(short ?? ""));
  if (known?.badge) return known.badge;
  // Badges hold one line: a known organization's short name of up to 6 characters (the well-known
  // acronyms UNICEF, UNESCO, UNAIDS), any other short name of up to 5; otherwise initials.
  for (const [candidate, max] of [[known?.short, 6], [short, 5]] as const) {
    const s = (candidate || "").replace(/[^A-Za-z0-9-]/g, "");
    if (s && s.length <= max) return s;
  }
  // Initials of the meaningful words: "Agency for Technical Cooperation and Development" → "ATCD"
  const small = new Set(["for", "and", "of", "the", "de", "du", "des", "la", "le", "les", "et", "en", "pour", "y", "del", "in", "on"]);
  const words = (name || short || "?").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/).filter((w) => w && !small.has(w.toLowerCase()));
  if (words.length === 1) return /^[A-Z0-9]{2,5}$/.test(words[0]) ? words[0] : words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase() || "?";
}

/** Serialize structured data safely inside a <script> tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export { siteConfig };
