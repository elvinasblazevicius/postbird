import type { Metadata } from "next";
import { EpsoBook } from "@/components/epso-book";
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
  const count = await countFor({ orgtype: [orgtype] }, false);
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
  const [profile, open] = await Promise.all([
    filteredFacets({ orgtype: [orgtype] }).then(postingProfile).catch(() => null),
    countFor({ orgtype: [orgtype] }).catch(() => null),
  ]);
  // No listings of this type at all: say so plainly, and offer the general email rather than one for this type.
  const empty = open === 0;
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
        <JobsBrowser
          filters={filters}
          fixed={{ orgtype: [orgtype] }}
          base={page.path}
          alertNoun={empty ? undefined : page.alertNoun}
          emptyTitle={empty ? `We don't list any vacancies from ${page.emptyName} right now.` : undefined}
          generalAlert={empty}
        />
        {/* Our own EPSO workbook, only on the EU institutions page (as on EU job and organization pages). */}
        {orgtype === "eu" ? <EpsoBook className="mt-10 max-w-2xl" source="eu-jobs" /> : null}
      </div>
    </>
  );
}
