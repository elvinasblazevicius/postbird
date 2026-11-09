import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { countryFacets, regionFacets } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "International jobs by region and country",
  description: "Find UN and international organization vacancies by duty station country.",
  alternates: { canonical: "/locations" },
};

export default async function LocationsPage() {
  const [countries, regions] = await Promise.all([countryFacets(), regionFacets()]);
  const byLetter = new Map<string, typeof countries>();
  for (const c of [...countries].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = c.name.normalize("NFD")[0].toUpperCase();
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), c]);
  }
  return (
    <>
      <PageHeader
        title="Jobs by region and country"
        crumbs={[{ href: "/", label: "Home" }, { href: "/locations", label: "Locations" }]}
        intro={`${countries.length} countries currently have open vacancies. Jobs without a stated location are listed under all jobs.`}
      />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="text-[1.5rem] font-semibold text-ink">Regions</h2>
        <ul className="mt-4 mb-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {regions.filter((r) => r.count > 0).map((r) => (
            <li key={r.slug}>
              <Link href={`/locations/${r.slug}`} className="card-lift flex items-baseline justify-between rounded-xl border border-rule bg-paper px-4 py-3 hover:border-brand">
                <span className="font-medium text-ink">{r.name}</span>
                <span className="text-sm tabular-nums text-slate">{r.count}</span>
              </Link>
            </li>
          ))}
        </ul>
        <h2 className="mb-4 text-[1.5rem] font-semibold text-ink">Countries</h2>
        <div className="columns-1 gap-10 sm:columns-2 lg:columns-3">
          {[...byLetter.entries()].map(([letter, list]) => (
            <section key={letter} className="mb-6 break-inside-avoid">
              <h2 className="font-display text-lg font-semibold text-brand">{letter}</h2>
              <ul className="mt-1">
                {list.map((c) => (
                  <li key={c.code}>
                    <Link href={`/locations/${c.slug}`} className="flex justify-between gap-3 py-1.5 text-ink hover:text-accent">
                      <span>{c.name}</span>
                      <span className="text-sm tabular-nums text-slate">{c.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
