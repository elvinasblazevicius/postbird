import { countryFacets, filtersFromQuery, organizationFacets, regionFacets } from "@/lib/jobs";
import { WatchFieldset, type FacetData } from "./search-forms";

/**
 * The optional "What should we watch for?" fields of the alert sign-up form (/alerts, /pricing/trial).
 * Rendered on the server (the option lists come from the database) and placed inside the client
 * sign-up form, so they are sent with it. Prefilled from a search started on the jobs page; then
 * the hint says the email follows that search, with a link (`resetHref`: the same page without the
 * search) to start from scratch instead. `fold`: just the fields, for the free weekly form, which
 * folds them under "Narrow it down (optional)" and shows the carried-over search above its email field.
 */
export async function WatchFields({ search, searchLabel, hint, resetHref, fold = false, part = "all" }: { search: string | null; searchLabel: string | null; hint?: string; resetHref?: string; fold?: boolean; part?: "all" | "keywords" | "places" }) {
  const filters = search ? filtersFromQuery(search) : {};
  if (part === "keywords") return <WatchFieldset facets={{ orgs: [], countries: [], regions: [], categories: [], grades: [] }} filters={filters} part="keywords" />;
  const [orgs, countries, regions] = await Promise.all([
    organizationFacets(500, false).catch(() => []),
    countryFacets(false).catch(() => []),
    regionFacets(false).catch(() => []),
  ]);
  const facets: FacetData = { orgs: orgs.map((o) => ({ slug: o.slug, name: o.name, count: o.count })), countries, regions, categories: [], grades: [] };
  const fieldset = (
    <WatchFieldset
      facets={facets}
      filters={filters}
      hideLegend={fold}
      part={part}
      hint={
        search && resetHref ? (
          <>
            Your email will follow this search. Edit it below or{" "}
            {/* A full page load, so every field starts empty again (a client-side navigation would keep what the fields hold). */}
            <a href={resetHref} className="font-medium text-accent underline underline-offset-2">start from scratch</a>.
          </>
        ) : (
          hint
        )
      }
    />
  );
  if (fold) return fieldset;
  return (
    <div className="rounded-xl border border-rule p-5">
      {searchLabel ? <p className="mb-4 rounded-lg bg-mist px-3 py-2 text-sm text-ink">From your search: {searchLabel}</p> : null}
      {fieldset}
    </div>
  );
}
