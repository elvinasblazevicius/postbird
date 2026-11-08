import type { MetadataRoute } from "next";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { categoryFacets, countryFacets, organizationFacets, regionFacets } from "@/lib/jobs";
import { countFor } from "@/lib/landing";
import { absoluteUrl, jobPath } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Only pages worth indexing: open, non-demo jobs and landing pages with enough jobs. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const min = LISTING_SETTINGS.minJobsForIndexedLandingPage;
  const now = new Date();
  const [jobs, orgs, cats, countries, remote, regions] = await Promise.all([
    sql<{ id: number; slug: string; updated_at: Date }[]>`
      select id, slug, updated_at from jobs
      where status = 'active' and not is_demo
        and (deadline is null or deadline >= (now() at time zone 'utc')::date)
        and (${LISTING_SETTINGS.indexJobsWithoutDescription} or summary is not null or description_html is not null)
      order by coalesce(published_at, first_seen_at) desc limit 45000`,
    organizationFacets(500, false),
    categoryFacets(false),
    countryFacets(false),
    countFor({ remote: true }, false),
    regionFacets(false),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: absoluteUrl("/jobs"), lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: absoluteUrl("/organizations"), lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: absoluteUrl("/categories"), lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: absoluteUrl("/locations"), lastModified: now, changeFrequency: "daily", priority: 0.5 },
    { url: absoluteUrl("/alerts"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/pricing"), changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.3 },
  ];
  if (remote >= min) staticPages.push({ url: absoluteUrl("/remote-jobs"), lastModified: now, changeFrequency: "daily", priority: 0.8 });

  return [
    ...staticPages,
    ...orgs.filter((o) => o.count >= min).map((o) => ({ url: absoluteUrl(`/organizations/${o.slug}`), lastModified: now, changeFrequency: "daily" as const, priority: 0.7 })),
    ...cats.filter((c) => c.count >= min).map((c) => ({ url: absoluteUrl(`/categories/${c.slug}`), lastModified: now, changeFrequency: "daily" as const, priority: 0.7 })),
    ...regions.filter((r) => r.count >= min).map((r) => ({ url: absoluteUrl(`/locations/${r.slug}`), lastModified: now, changeFrequency: "daily" as const, priority: 0.6 })),
    ...countries.filter((c) => c.count >= min).map((c) => ({ url: absoluteUrl(`/locations/${c.slug}`), lastModified: now, changeFrequency: "daily" as const, priority: 0.6 })),
    ...jobs.map((j) => ({ url: absoluteUrl(jobPath(j)), lastModified: j.updated_at, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
