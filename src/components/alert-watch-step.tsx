import { countryFacets, organizationFacets, parseFilters, regionFacets } from "@/lib/jobs";
import { alertStepKeep } from "@/lib/saved-searches";
import { WatchForForm, type FacetData } from "./search-forms";

/**
 * The optional "What should we watch for?" step above the alert sign-up form. Its answers become
 * the saved search the sign-up form sends (the same ?search mechanism the jobs pages use).
 * `chosen`: the step was submitted (with or without answers), so show the choice instead of the form.
 */
export async function AlertWatchStep({ action, search, searchLabel, chosen = false, extraKeep = {} }: {
  action: string;
  search: string | null;
  searchLabel: string | null;
  chosen?: boolean;
  extraKeep?: Record<string, string>;
}) {
  const [orgs, countries, regions] = await Promise.all([
    organizationFacets(500, false).catch(() => []),
    countryFacets(false).catch(() => []),
    regionFacets(false).catch(() => []),
  ]);
  const facets: FacetData = { orgs: orgs.map((o) => ({ slug: o.slug, name: o.name, count: o.count })), countries, regions, categories: [], grades: [] };
  const filters = search ? parseFilters(Object.fromEntries(new URLSearchParams(search))) : {};
  const form = <WatchForForm action={`${action}#alert-signup`} facets={facets} filters={filters} keep={{ ...alertStepKeep(search), ...extraKeep }} />;
  return (
    <section aria-labelledby="watch-heading" className="mb-8 rounded-xl border border-rule p-5">
      {search || chosen ? (
        <>
          <h2 id="watch-heading" className="text-base font-semibold text-ink">What we&apos;ll watch for</h2>
          <p className="mt-1 text-ink">{searchLabel ?? "All new vacancies"}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-accent">Change this</summary>
            <div className="mt-4">{form}</div>
          </details>
        </>
      ) : (
        <>
          <h2 id="watch-heading" className="text-xl font-semibold text-ink">What should we watch for?</h2>
          <p className="mt-1 text-sm text-slate">Optional. Choose a keyword, organization or location, or skip this step.</p>
          <div className="mt-4">{form}</div>
        </>
      )}
    </section>
  );
}
