import type { Metadata } from "next";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { employerTypePage, type EmployerTypePage } from "@/lib/employer-types";
import { filteredFacets, parseFilters } from "@/lib/jobs";
import { countFor, landingMetadata } from "@/lib/landing";
import { nonAffiliationLine } from "@/lib/org-names";
import { postingProfile } from "@/lib/org-profile";
import { siteConfig } from "@/lib/site";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Metadata for an employer-type page; kept out of search indexes while it has too few (or no) jobs. */
export async function employerTypeMetadata(orgtype: EmployerTypePage["orgtype"], searchParams: SP): Promise<Metadata> {
  const page = employerTypePage(orgtype);
  const count = await countFor({ orgtype }, false);
  return landingMetadata({
    title: page.metaTitle,
    description: count > 0 ? `${count} open vacancies. ${page.intro}` : page.intro,
    path: page.path,
    count,
    filters: parseFilters(await searchParams),
    noindex: count === 0,
  });
}

export async function EmployerTypeListing({ orgtype, searchParams }: { orgtype: EmployerTypePage["orgtype"]; searchParams: SP }) {
  const page = employerTypePage(orgtype);
  const filters = parseFilters(await searchParams);
  delete filters.orgtype;
  // What this type of employer posts, from its open listings (a page-specific intro; nothing when the counts can't be read).
  const profile = await filteredFacets({ orgtype }).then(postingProfile).catch(() => null);
  return (
    <>
      <PageHeader
        title={page.title}
        crumbs={[{ href: "/", label: "Home" }, { href: page.path, label: page.title }]}
        intro={profile ? `${page.intro} ${profile}` : page.intro}
        note={nonAffiliationLine(siteConfig.name, null)}
        compact
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBrowser filters={filters} fixed={{ orgtype }} base={page.path} alertNoun={page.alertNoun} />
      </div>
    </>
  );
}
