import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { countryBySlug } from "@/config/countries";
import { parseFilters } from "@/lib/jobs";
import { countFor, landingMetadata } from "@/lib/landing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const country = countryBySlug(slug);
  if (!country) return { title: "Location not found", robots: { index: false } };
  const count = await countFor({ country: slug });
  return landingMetadata({
    title: `UN and NGO jobs in ${country.name}`,
    description: `${count} open vacancies in ${country.name} at UN agencies, international organizations and NGOs, with application deadlines and links to the official postings.`,
    path: `/locations/${slug}`,
    count,
    filters: parseFilters(await searchParams),
  });
}

export default async function LocationPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const country = countryBySlug(slug);
  if (!country) notFound();
  const filters = parseFilters(await searchParams);
  delete filters.country;
  return (
    <>
      <PageHeader
        title={`Jobs in ${country.name}`}
        crumbs={[{ href: "/", label: "Home" }, { href: "/locations", label: "Countries" }, { href: `/locations/${slug}`, label: country.name }]}
        intro={`Vacancies with a duty station in ${country.name}. Home-based roles are listed separately under remote jobs.`}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBrowser filters={filters} fixed={{ country: slug }} base={`/locations/${slug}`} />
      </div>
    </>
  );
}
