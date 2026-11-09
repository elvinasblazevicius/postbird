import { countryFacets, filtersFromQuery, organizationFacets, regionFacets } from "@/lib/jobs";
import { WatchFieldset, type FacetData } from "./search-forms";

/**
 * The optional "What should we watch for?" fields of the alert sign-up form (/alerts, /pricing/trial).
 * Rendered on the server (the option lists come from the database) and placed inside the client
 * sign-up form, so they are sent with it. Prefilled from a search started on the jobs page; then
 * the hint says the email follows that search, with a link (`resetHref`: the same page without the
 * search) to start from scratch instead.
 */
export async function WatchFields({ search, searchLabel, hint, resetHref }: { search: string | null; searchLabel: string | null; hint?: string; resetHref?: string }) {
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
      <WatchFieldset
        facets={facets}
        filters={filters}
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
    </div>
  );
}
