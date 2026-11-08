import type { Metadata } from "next";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { countryBySlug } from "@/config/countries";
import { regionBySlug } from "@/config/regions";
import { jobsUrl, type JobFilters } from "@/lib/jobs";

/** Number of open jobs for a landing page's fixed filter. */
export async function countFor(fixed: Partial<JobFilters>, includeDemo = true): Promise<number> {
  let w = sql`j.status = 'active' and (${includeDemo} or not j.is_demo)`;
  if (fixed.org) w = sql`${w} and o.slug = ${fixed.org}`;
  if (fixed.category) w = sql`${w} and j.category = ${fixed.category}`;
  if (fixed.country) w = sql`${w} and j.country_code = ${countryBySlug(fixed.country)?.code ?? "--"}`;
  if (fixed.region) w = sql`${w} and j.country_code = any(${regionBySlug(fixed.region)?.codes ?? []})`;
  if (fixed.remote) w = sql`${w} and j.is_remote is true`;
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j left join organizations o on o.id = j.organization_id where ${w}`;
  return r.n;
}

/**
 * Metadata for a landing page. Pages with too few jobs, or with extra
 * filters applied, are kept out of search indexes to avoid thin/duplicate pages.
 */
export function landingMetadata(opts: { title: string; description: string; path: string; count: number; filters: JobFilters }): Metadata {
  const hasExtra = Object.entries(opts.filters).some(([k, v]) => k !== "page" && v);
  const thin = opts.count < LISTING_SETTINGS.minJobsForIndexedLandingPage;
  const canonical = opts.filters.page && !hasExtra ? jobsUrl({ page: opts.filters.page }, opts.path) : opts.path;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical },
    robots: thin || hasExtra ? { index: false, follow: true } : undefined,
    openGraph: { title: opts.title, description: opts.description, url: opts.path },
  };
}
