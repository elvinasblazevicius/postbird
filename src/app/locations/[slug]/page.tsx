import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { countryBySlug } from "@/config/countries";
import { regionBySlug } from "@/config/regions";
import { parseFilters, type JobFilters } from "@/lib/jobs";
import { countFor, landingMetadata } from "@/lib/landing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** A country (e.g. /locations/kenya) or a world region (e.g. /locations/africa). */
function resolve(slug: string): { name: string; fixed: Partial<JobFilters>; isRegion: boolean } | null {
  const country = countryBySlug(slug);
  if (country) return { name: country.name, fixed: { country: slug }, isRegion: false };
  const region = regionBySlug(slug);
  if (region) return { name: region.name, fixed: { region: slug }, isRegion: true };
  return null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const place = resolve(slug);
  if (!place) return { title: "Location not found", robots: { index: false } };
  const count = await countFor(place.fixed, false);
  return landingMetadata({
    title: `UN and international organization jobs in ${place.name}`,
    description: `${count} open vacancies in ${place.name} at UN agencies and international organizations, with application deadlines and links to the official postings.`,
    path: `/locations/${slug}`,
    count,
    filters: parseFilters(await searchParams),
  });
}

export default async function LocationPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const place = resolve(slug);
  if (!place) notFound();
  const filters = parseFilters(await searchParams);
  delete filters.country;
  delete filters.region;
  return (
    <>
      <PageHeader
        title={`Jobs in ${place.name}`}
        crumbs={[{ href: "/", label: "Home" }, { href: "/locations", label: "Locations" }, { href: `/locations/${slug}`, label: place.name }]}
        intro={`Vacancies with a duty station in ${place.isRegion ? "this region" : place.name}. Home-based roles are listed separately under remote jobs.`}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBrowser filters={filters} fixed={place.fixed} base={`/locations/${slug}`} />
      </div>
    </>
  );
}
