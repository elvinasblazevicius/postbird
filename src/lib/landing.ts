import type { Metadata } from "next";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { countJobs, jobsUrl, type JobFilters } from "@/lib/jobs";

/**
 * Number of open jobs for a landing page's fixed filter: the same count as the list under it
 * (countJobs in src/lib/jobs.ts), so "11 open vacancies" and the cards always agree.
 */
export async function countFor(fixed: Partial<JobFilters>, includeDemo = true): Promise<number> {
  return countJobs({ ...fixed, excludeDemo: !includeDemo || undefined });
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
