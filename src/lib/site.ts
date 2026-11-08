import siteConfig from "@site-config";
import { categoryBySlug } from "@/config/categories";
import { countryByCode } from "@/config/countries";
import { LISTING_SETTINGS } from "@/config/import";

export const NOT_SPECIFIED = "Not specified";

/** Public base URL: site.config.ts → NEXT_PUBLIC_SITE_URL → Netlify/Vercel address → localhost. */
export function siteUrl(): string {
  const fromConfig = siteConfig.url?.trim();
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  // Netlify sets URL to the site's main address (custom domain or *.netlify.app).
  const netlify = process.env.NETLIFY ? process.env.URL : undefined;
  const url = fromConfig || fromEnv || netlify || (vercel ? `https://${vercel}` : `http://localhost:${process.env.PORT || 3000}`);
  return url.replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function jobPath(job: { id: number; slug: string }): string {
  return `/jobs/${job.slug}-${job.id}`;
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
  if (j.location_text) return j.location_text;
  if (j.is_remote) return "Remote";
  return NOT_SPECIFIED;
}

export function categoryName(slug: string): string {
  return categoryBySlug(slug)?.name ?? "Other";
}

/** Short text badge for an organization (no logos: avoids implying endorsement). */
export function monogram(name: string | null, short: string | null): string {
  const s = (short || "").replace(/[^A-Za-z0-9-]/g, "");
  if (s && s.length <= 6) return s;
  // Initials of the meaningful words: "Agency for Technical Cooperation and Development" → "ATCD"
  const small = new Set(["for", "and", "of", "the", "de", "du", "des", "la", "le", "les", "et", "en", "pour", "y", "del", "in", "on"]);
  const words = (name || short || "?").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/).filter((w) => w && !small.has(w.toLowerCase()));
  if (words.length === 1) return /^[A-Z0-9]{2,6}$/.test(words[0]) ? words[0] : words[0].slice(0, 2).toUpperCase();
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
