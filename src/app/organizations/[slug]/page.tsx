import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { getOrganization, parseFilters } from "@/lib/jobs";
import { countFor, landingMetadata } from "@/lib/landing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const org = await getOrganization(slug);
  if (!org) return { title: "Organization not found", robots: { index: false } };
  const count = await countFor({ org: slug }, false);
  const label = org.short_name && org.short_name !== org.name ? `${org.name} (${org.short_name})` : org.name;
  return landingMetadata({
    title: `${org.short_name ?? org.name} jobs — ${count} open vacancies`,
    description: `Open vacancies at ${label}: current job openings, consultancies and internships with locations and application deadlines. Apply on the official website.`,
    path: `/organizations/${slug}`,
    count,
    filters: parseFilters(await searchParams),
  });
}

export default async function OrganizationPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const org = await getOrganization(slug);
  if (!org) notFound();
  const filters = parseFilters(await searchParams);
  delete filters.org;
  const count = await countFor({ org: slug });
  return (
    <>
      <PageHeader
        title={`Jobs at ${org.name}`}
        crumbs={[{ href: "/", label: "Home" }, { href: "/organizations", label: "Organizations" }, { href: `/organizations/${slug}`, label: org.short_name ?? org.name }]}
        intro={
          <>
            {count === 1 ? "1 open vacancy" : `${count} open vacancies`}
            {org.org_type ? ` at this ${org.org_type === "UN system" ? "UN system organization" : org.org_type.toLowerCase()}` : ""}. Listings link to the
            organization&apos;s official vacancy pages.
          </>
        }
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBrowser filters={filters} fixed={{ org: slug }} base={`/organizations/${slug}`} />
      </div>
    </>
  );
}
