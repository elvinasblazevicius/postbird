import type { Metadata } from "next";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { countryBySlug } from "@/config/countries";
import { ORG_TYPES, regionBySlug } from "@/config/regions";
import { jobsUrl, placeCondition, type JobFilters } from "@/lib/jobs";

/** Number of open jobs for a landing page's fixed filter. */
export async function countFor(fixed: Partial<JobFilters>, includeDemo = true): Promise<number> {
  let w = sql`j.status = 'active' and (j.deadline is null or j.deadline >= (now() at time zone 'utc')::date) and (${includeDemo} or not j.is_demo)`;
  if (fixed.org?.length) w = sql`${w} and o.slug = any(${fixed.org})`;
  if (fixed.category) w = sql`${w} and j.category = ${fixed.category}`;
  if (fixed.country?.length || fixed.region?.length) {
    // Any of the countries and regions, like the "where" filter (filterConditions in src/lib/jobs.ts).
    const codes = [
      ...(fixed.country ?? []).flatMap((s) => countryBySlug(s)?.code ?? []),
      ...(fixed.region ?? []).flatMap((s) => regionBySlug(s)?.codes ?? []),
    ];
    w = codes.length ? sql`${w} and ${placeCondition([...new Set(codes)])}` : sql`${w} and false`;
  }
  if (fixed.remote) w = sql`${w} and j.is_remote is true`;
  if (fixed.orgtype) w = sql`${w} and o.org_type = ${ORG_TYPES.find((t) => t.value === fixed.orgtype)?.type ?? "--"}`;
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j left join organizations o on o.id = j.organization_id where ${w}`;
  return r.n;
}

/** The contract types among the open jobs for a landing page's fixed organization (for its description). */
export async function jobTypesFor(fixed: { org: string }, includeDemo = true): Promise<Set<string>> {
  const rows = await sql<{ t: string }[]>`
    select distinct j.job_type as t from jobs j join organizations o on o.id = j.organization_id
    where o.slug = ${fixed.org} and j.job_type is not null and j.status = 'active'
      and (j.deadline is null or j.deadline >= (now() at time zone 'utc')::date) and (${includeDemo} or not j.is_demo)`;
  return new Set(rows.map((r) => r.t));
}

/**
 * Metadata for a landing page. Pages with too few jobs, or with extra
 * filters applied, are kept out of search indexes to avoid thin/duplicate pages.
 * Filtered views get no canonical (it would point elsewhere and contradict the
 * noindex); the others point to themselves. noindex: true forces noindex
 * (e.g. the catch-all "Other" category).
 */
export function landingMetadata(opts: { title: string; description: string; path: string; count: number; filters: JobFilters; noindex?: boolean }): Metadata {
  const hasExtra = Object.entries(opts.filters).some(([k, v]) => k !== "page" && v);
  const thin = opts.count < LISTING_SETTINGS.minJobsForIndexedLandingPage;
  const canonical = opts.filters.page ? jobsUrl({ page: opts.filters.page }, opts.path) : opts.path;
  return {
    title: opts.title,
    description: opts.description,
    alternates: hasExtra ? undefined : { canonical },
    robots: thin || hasExtra || opts.noindex ? { index: false, follow: true } : undefined,
    openGraph: { title: opts.title, description: opts.description, url: opts.path },
  };
}
