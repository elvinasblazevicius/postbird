import { countryFacets, filtersFromQuery, organizationFacets, regionFacets } from "@/lib/jobs";
import { WatchFieldset, type FacetData } from "./search-forms";

/**
 * The optional "What should we watch for?" fields of the alert sign-up form (/alerts, /pricing/trial).
 * Rendered on the server (the option lists come from the database) and placed inside the client
 * sign-up form, so they are sent with it. Prefilled from a search started on the jobs page.
 */
export async function WatchFields({ search, searchLabel, hint }: { search: string | null; searchLabel: string | null; hint?: string }) {
  const [orgs, countries, regions] = await Promise.all([
    organizationFacets(500, false).catch(() => []),
    countryFacets(false).catch(() => []),
    regionFacets(false).catch(() => []),
  ]);
  const facets: FacetData = { orgs: orgs.map((o) => ({ slug: o.slug, name: o.name, count: o.count })), countries, regions, categories: [], grades: [] };
  const filters = search ? filtersFromQuery(search) : {};
  return (
    <div className="rounded-xl border border-rule p-5">
      {searchLabel ? <p className="mb-4 rounded-lg bg-mist px-3 py-2 text-sm text-ink">From your search: {searchLabel}</p> : null}
      <WatchFieldset facets={facets} filters={filters} hint={hint} />
    </div>
  );
}
