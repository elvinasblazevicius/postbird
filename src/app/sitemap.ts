import type { MetadataRoute } from "next";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { categoryFacets, countryFacets, organizationFacets, regionFacets } from "@/lib/jobs";
import { BILLING_LIVE } from "@/lib/billing/live";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { countFor } from "@/lib/landing";
import { absoluteUrl, jobPath, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Only pages worth indexing: open, non-demo jobs and landing pages with enough jobs.
 * lastModified is given only where it is a real date: each job's last change,
 * and for the homepage and /jobs (which list every job) the newest of those.
 * Other pages have no lastmod rather than an invented one.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const min = LISTING_SETTINGS.minJobsForIndexedLandingPage;
  const [jobs, orgs, cats, countries, remote, regions, typeCounts] = await Promise.all([
    sql<{ id: number; slug: string; updated_at: Date }[]>`
      select id, slug, updated_at from jobs
      where status = 'active' and not is_demo
        and (deadline is null or deadline >= (now() at time zone 'utc')::date)
        and (${LISTING_SETTINGS.indexJobsWithoutDescription} or summary is not null or description_html is not null)
      order by coalesce(published_at, first_seen_at) desc, id desc limit 45000`,
    organizationFacets(500, false),
    categoryFacets(false),
    countryFacets(false),
    countFor({ remote: true }, false),
    regionFacets(false),
    Promise.all(EMPLOYER_TYPE_PAGES.map((t) => countFor({ orgtype: t.orgtype }, false))),
  ]);
  const newest = jobs.reduce<Date | undefined>((max, j) => (!max || j.updated_at > max ? j.updated_at : max), undefined);

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: newest, changeFrequency: "hourly", priority: 1 },
    { url: absoluteUrl("/jobs"), lastModified: newest, changeFrequency: "hourly", priority: 0.9 },
    { url: absoluteUrl("/organizations"), changeFrequency: "daily", priority: 0.6 },
    { url: absoluteUrl("/categories"), changeFrequency: "daily", priority: 0.6 },
    { url: absoluteUrl("/locations"), changeFrequency: "daily", priority: 0.5 },
    // /alerts is the free weekly email; without it, once billing is live, /alerts redirects to the trial page.
    ...(BILLING_LIVE && !siteConfig.freeWeeklyEmail ? [] : [{ url: absoluteUrl("/alerts"), changeFrequency: "monthly" as const, priority: 0.4 }]),
    { url: absoluteUrl("/grades"), changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/guides/how-to-read-a-un-vacancy"), changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/pricing"), changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.3 },
  ];
  if (remote >= min) staticPages.push({ url: absoluteUrl("/remote-jobs"), changeFrequency: "daily", priority: 0.8 });
  EMPLOYER_TYPE_PAGES.forEach((t, i) => {
    if (typeCounts[i] >= min) staticPages.push({ url: absoluteUrl(t.path), changeFrequency: "daily", priority: 0.8 });
  });

  return [
    ...staticPages,
    ...orgs.filter((o) => o.count >= min).map((o) => ({ url: absoluteUrl(`/organizations/${o.slug}`), changeFrequency: "daily" as const, priority: 0.7 })),
    // "Other" is noindex (see categories/[slug]), so it isn't listed.
    ...cats.filter((c) => c.count >= min && c.slug !== "other").map((c) => ({ url: absoluteUrl(`/categories/${c.slug}`), changeFrequency: "daily" as const, priority: 0.7 })),
    ...regions.filter((r) => r.count >= min).map((r) => ({ url: absoluteUrl(`/locations/${r.slug}`), changeFrequency: "daily" as const, priority: 0.6 })),
    ...countries.filter((c) => c.count >= min).map((c) => ({ url: absoluteUrl(`/locations/${c.slug}`), changeFrequency: "daily" as const, priority: 0.6 })),
    ...jobs.map((j) => ({ url: absoluteUrl(jobPath(j)), lastModified: j.updated_at, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
