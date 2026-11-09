import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { categoryFacets } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "International jobs by career category",
  description: "Browse UN and international organization vacancies by field: data and analytics, IT, programme management, finance, HR, communications and more.",
  alternates: { canonical: "/categories" },
};

export default async function CategoriesPage() {
  const cats = await categoryFacets();
  return (
    <>
      <PageHeader
        title="Browse by career category"
        crumbs={[{ href: "/", label: "Home" }, { href: "/categories", label: "Categories" }]}
        intro="Each vacancy is placed in a category based on its job title."
      />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cats.filter((c) => c.count > 0).map((c) => (
            <li key={c.slug}>
              <Link href={`/categories/${c.slug}`} className="block h-full rounded-xl border border-rule p-5 hover:border-accent">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold text-ink">{c.name}</h2>
                  <span className="text-sm tabular-nums text-slate">{c.count} open</span>
                </div>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-slate">{c.blurb}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
