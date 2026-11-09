import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobsBrowser } from "@/components/jobs-browser";
import { OrgBadge } from "@/components/job-card";
import { EpsoBook, isEuInstitution } from "@/components/epso-book";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { ORG_TYPES } from "@/config/regions";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { getOrganization, organizationPostingMix, parseFilters, POSTING_MIX_DAYS } from "@/lib/jobs";
import { countFor, jobTypesFor, landingMetadata } from "@/lib/landing";
import { isAcronym, nonAffiliationLine, orgInText, withArticle } from "@/lib/org-names";
import { usuallyPosts } from "@/lib/org-profile";
import { officialSite } from "@/lib/recruitment-system";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const org = await getOrganization(slug);
  if (!org) return { title: "Organization not found" }; // the 404 page adds the noindex tag
  const [count, types] = await Promise.all([countFor({ org: [slug] }, false), jobTypesFor({ org: slug }, false)]);
  const label = withArticle(org.short_name && org.short_name !== org.name ? `${org.name} (${org.short_name})` : org.name);
  // Only the kinds of post the organization has open right now.
  const kinds = [types.has("Consultancy") ? "consultancies" : null, types.has("Internship") ? "internships" : null].filter(Boolean);
  return landingMetadata({
    title: `${org.short_name ?? org.name} jobs — ${count === 1 ? "1 open vacancy" : `${count} open vacancies`}`,
    description: `Open vacancies at ${label}${kinds.length ? `, including ${kinds.join(" and ")},` : ""} with locations and application deadlines. Apply on the employer's own website.`,
    path: `/organizations/${slug}`,
    count,
    filters: parseFilters(await searchParams),
  });
}

export default async function OrganizationPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const org = await getOrganization(slug);
  if (!org) notFound();
  const filters = parseFilters(await searchParams);
  delete filters.org;
  const [count, mix] = await Promise.all([countFor({ org: [slug] }), organizationPostingMix(slug).catch(() => null)]);
  // A few facts, each from the data or the known-organizations list, never assumed.
  const typePage = EMPLOYER_TYPE_PAGES.find((p) => p.orgtype === ORG_TYPES.find((t) => t.type === org.org_type)?.value);
  const site = officialSite(org.name, org.short_name);
  const usually = mix ? usuallyPosts(mix) : null;
  return (
    <>
      <PageHeader
        title={isAcronym(org.short_name) ? `${org.short_name}: open vacancies` : `Vacancies at ${withArticle(org.name)}`}
        badge={<OrgBadge name={org.name} short={org.short_name} size="lg" />}
        crumbs={[{ href: "/", label: "Home" }, { href: "/organizations", label: "Organizations" }, { href: `/organizations/${slug}`, label: org.short_name ?? org.name }]}
        intro={
          <>
            {count === 1 ? "1 open vacancy" : `${count} open vacancies`}
            {org.org_type ? ` at this ${org.org_type === "UN system" ? "UN system organization" : org.org_type.replace(/^[A-Z][a-z]/, (c) => c.toLowerCase())}` : ""}. Listings link to the
            organization&apos;s own website.
          </>
        }
        note={nonAffiliationLine(siteConfig.name, orgInText(org.name, org.short_name))}
      >
        {typePage || site || usually ? (
          <dl className="mt-5 flex max-w-4xl flex-col gap-3 text-[0.95rem] sm:flex-row sm:flex-wrap sm:gap-x-10">
            {typePage ? (
              <div>
                <dt className="text-xs text-slate">Employer type</dt>
                <dd className="mt-0.5"><Link href={typePage.path} className="text-accent underline-offset-2 hover:underline">{typePage.label}</Link></dd>
              </div>
            ) : null}
            {site ? (
              <div className="min-w-0">
                <dt className="text-xs text-slate">{site.careers ? "Official careers site" : "Official website"}</dt>
                <dd className="mt-0.5 break-all">
                  <a href={site.href} rel="noopener" className="text-accent underline-offset-2 hover:underline">{site.host}</a>
                </dd>
              </div>
            ) : null}
            {usually ? (
              <div className="min-w-0 sm:max-w-md">
                <dt className="text-xs text-slate">Usually posts</dt>
                <dd className="mt-0.5 text-ink">
                  {usually.charAt(0).toUpperCase() + usually.slice(1)}
                  <span className="block text-xs text-slate">From its listings of the past {Math.round(POSTING_MIX_DAYS / 30)} months</span>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </PageHeader>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {isEuInstitution(org.org_type) ? <EpsoBook className="mb-6 max-w-2xl" source="org-page" /> : null}
        <JobsBrowser filters={filters} fixed={{ org: [slug] }} base={`/organizations/${slug}`} alertNoun={orgInText(org.name, org.short_name) ?? undefined} />
      </div>
    </>
  );
}
