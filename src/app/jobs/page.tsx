import type { Metadata } from "next";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { categoryBySlug } from "@/config/categories";
import { countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, regionBySlug } from "@/config/regions";
import { activeFilterCount, getOrganization, parseFilters, type JobFilters } from "@/lib/jobs";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function describe(f: JobFilters): Promise<string> {
  const parts: string[] = [];
  if (f.remote) parts.push("Remote");
  if (f.grade) parts.push(GRADE_GROUPS.find((g) => g.value === f.grade)?.name.replace(/ \(.*\)$/, "") ?? f.grade);
  if (f.category) parts.push(categoryBySlug(f.category)?.name ?? "");
  let title = parts.filter(Boolean).join(" ") || "International";
  title += " jobs";
  if (f.org) {
    const org = await getOrganization(f.org);
    if (org) title += ` at ${org.name}`;
  }
  if (f.country) title += ` in ${countryBySlug(f.country)?.name}`;
  if (f.region) title += ` in ${regionBySlug(f.region)?.name}`;
  if (f.q) title = `“${f.q}” — ${title}`;
  return title;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const f = parseFilters(await searchParams);
  const filtered = activeFilterCount(f) > 0 || (f.sort && f.sort !== "newest");
  const title = filtered ? await describe(f) : "International jobs at the UN and international organizations";
  return {
    title: f.page && !filtered ? `${title} — page ${f.page}` : title,
    description: "Search open vacancies from UN agencies and international organizations. Filter by organization, country, category, remote work and deadline.",
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
        intro="Vacancies from UN agencies and international organizations. Every listing links to the employer's own website."
      />
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-8">
        <JobsBrowser filters={filters} />
      </div>
    </>
  );
}
