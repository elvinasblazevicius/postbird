import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { categoryBySlug } from "@/config/categories";
import { parseFilters } from "@/lib/jobs";
import { countFor, landingMetadata } from "@/lib/landing";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const cat = categoryBySlug(slug);
  if (!cat) return { title: "Category not found" }; // the 404 page adds the noindex tag
  const count = await countFor({ category: [slug] }, false);
  const name = cat.slug === "other" ? "Other international" : cat.name;
  return landingMetadata({
    title: `${name} jobs at the UN and international organizations`,
    description: `${count} open ${cat.name.toLowerCase()} vacancies at UN agencies and international organizations. ${cat.blurb}`,
    path: `/categories/${slug}`,
    count,
    filters: parseFilters(await searchParams),
    // "Other" is a catch-all with no clear topic: useful to browse, not a search landing page.
    noindex: cat.slug === "other",
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const cat = categoryBySlug(slug);
  if (!cat) notFound();
  const filters = parseFilters(await searchParams);
  delete filters.category;
  return (
    <>
      <PageHeader
        title={`${cat.slug === "other" ? "Other" : cat.name} jobs`}
        crumbs={[{ href: "/", label: "Home" }, { href: "/categories", label: "Categories" }, { href: `/categories/${slug}`, label: cat.name }]}
        intro={`${cat.blurb} Openings at UN agencies and international organizations.`}
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBrowser filters={filters} fixed={{ category: [slug] }} base={`/categories/${slug}`} />
      </div>
    </>
  );
}
