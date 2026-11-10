import type { Metadata } from "next";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { categoryBySlug } from "@/config/categories";
import { gradeShortName, orList, placeNames } from "@/lib/filter-labels";
import { activeFilterCount, getOrganizations, parseFilters, type JobFilters } from "@/lib/jobs";
import { withArticle } from "@/lib/org-names";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { INDEPENDENCE_NOTE } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function describe(f: JobFilters): Promise<string> {
  const parts: string[] = [];
  if (f.remote) parts.push("Remote");
  if (f.grade?.length) parts.push(orList(f.grade.map(gradeShortName)));
  if (f.category) parts.push(categoryBySlug(f.category)?.name ?? "");
  const orgs = f.org?.length ? await getOrganizations(f.org) : [];
  // "Jobs at the International Organization for Migration", not "International jobs at the International …":
  // with an organization named, "International" adds nothing.
  let title = parts.filter(Boolean).join(" ") || (orgs.length ? "" : "International");
  title = title ? `${title} jobs` : "Jobs";
  if (orgs.length) title += ` at ${orList(orgs.map((o) => withArticle(o.name)))}`;
  const places = placeNames(f);
  if (places.length) title += ` in ${orList(places)}`;
  if (f.q) title = `“${f.q}” — ${title}`;
  return title;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const f = parseFilters(await searchParams);
  const filtered = activeFilterCount(f) > 0 || (f.sort && f.sort !== "newest");
  const title = filtered ? await describe(f) : "International jobs at the UN and international organizations";
  const pageTitle = f.page && !filtered ? `${title} — page ${f.page}` : title;
  const description = "Search open vacancies from UN agencies and international organizations. Filter by organization, country, category, remote work and deadline.";
  return {
    title: pageTitle,
    description,
    // A shared link shows this search, not the site's defaults.
    ...shareMetadata(sharedTitle(pageTitle), description),
    // Filtered views are useful to share but would duplicate landing pages in search engines,
    // so they are noindex and have no canonical (a canonical pointing elsewhere would
    // contradict the noindex). Unfiltered pages point to themselves.
    alternates: filtered ? undefined : { canonical: f.page ? `/jobs?page=${f.page}` : "/jobs" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function JobsPage({ searchParams }: Props) {
  const filters = parseFilters(await searchParams);
  const heading = activeFilterCount(filters) ? await describe(filters) : "All international jobs";
  return (
    <>
      <PageHeader
        compact
        title={heading}
        crumbs={[{ href: "/", label: "Home" }, { href: "/jobs", label: "Jobs" }]}
        intro="Open vacancies from UN agencies, NGOs and other international organizations. Filter by place, organization, grade, contract type and closing date."
        note={INDEPENDENCE_NOTE}
      />
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-8">
        <JobsBrowser filters={filters} />
      </div>
    </>
  );
}
