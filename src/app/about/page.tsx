import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ORG_TYPES } from "@/config/regions";
import { organizationFacets } from "@/lib/jobs";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How it works and where our listings come from",
  description: `How ${siteConfig.name} finds international vacancies, what we show, and how to apply.`,
  alternates: { canonical: "/about" },
};

/** Organizations with open vacancies now, by type (names only), for "Organizations we cover". */
async function coveredOrganizations() {
  const orgs = await organizationFacets(500, false).catch(() => []);
  const groups = [...ORG_TYPES.map((t) => ({ name: t.name, type: t.type as string | null })), { name: "Other organizations", type: null }]
    .map((g) => ({
      name: g.name,
      orgs: orgs
        .filter((o) => (g.type ? o.org_type === g.type : !ORG_TYPES.some((t) => t.type === o.org_type)))
        .map((o) => ({ slug: o.slug, name: o.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.orgs.length);
  return groups;
}

export default async function AboutPage() {
  const covered = await coveredOrganizations();
  return (
    <>
      <PageHeader width="max-w-3xl" title="How it works" crumbs={[{ href: "/", label: "Home" }, { href: "/about", label: "How it works" }]} />
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-12 text-[1.05rem] leading-relaxed text-ink sm:px-6">
        <section>
          <h2 className="text-2xl font-semibold leading-tight">Where the vacancies come from</h2>
          <p className="mt-3">
            {siteConfig.name} collects vacancies from public job feeds several times a day. New openings are added automatically, each one is linked to the
            employer&apos;s own website, and vacancies are hidden once their published closing date has passed.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold leading-tight">What we show</h2>
          <p className="mt-3">
            For each vacancy we show the details the source publishes: title, organization, location, dates and, where the source allows it, a summary or the full description.
            When our source doesn&apos;t give a detail, the listing says &quot;Not in our source&quot; rather than guessing; the employer&apos;s page may still have it. Categories are assigned from the job title.
          </p>
          <p className="mt-3">
            The same vacancy often appears on several websites. We combine those copies into a single listing that links to the employer&apos;s own website. Listings without a link to the employer aren&apos;t shown.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold leading-tight">How to apply</h2>
          <p className="mt-3">
            Every listing has an <strong>Apply</strong> button that opens the employer&apos;s own website: the vacancy itself, the employer&apos;s application form, or its careers page when that is all the posting links to. Applications go directly to the employer.
            We never accept applications, and genuine international organizations don&apos;t charge fees at any stage of recruitment. Treat any request for payment as a scam.
          </p>
        </section>
        {covered.length ? (
          <section id="organizations" aria-labelledby="covered-heading" className="scroll-mt-24">
            <h2 id="covered-heading" className="text-2xl font-semibold leading-tight">Organizations we cover</h2>
            <p className="mt-3">Organizations with open vacancies on {siteConfig.name} right now. The list changes as vacancies open and close.</p>
            <div className="mt-4 space-y-5">
              {covered.map((g) => (
                <div key={g.name}>
                  <h3 className="text-base font-semibold text-ink">{g.name}</h3>
                  <ul className="mt-1.5 flex flex-wrap gap-x-1 text-[0.98rem] text-ink">
                    {g.orgs.map((o, i) => (
                      <li key={o.slug}>
                        <Link href={`/organizations/${o.slug}`} className="text-accent hover:underline">{o.name}</Link>
                        {i < g.orgs.length - 1 ? <span className="text-slate">,</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <h2 className="text-2xl font-semibold leading-tight">Independence</h2>
          <p className="mt-3">{siteConfig.disclaimer}</p>
          <p className="mt-3">
            {siteConfig.name} is built and run by {siteConfig.operator.name}, a small independent {siteConfig.operator.legalForm.replace(/^an? /, "")}. Postal address:{" "}
            {siteConfig.operator.address}.
          </p>
          <p className="mt-3">
            Spotted a mistake or a listing that shouldn&apos;t be here?{" "}
            {siteConfig.contactEmail ? <a href={`mailto:${siteConfig.contactEmail}`} className="text-accent underline">Email us at {siteConfig.contactEmail}</a> : "Let us know"} and we&apos;ll fix or remove it.
          </p>
        </section>
        <p><Link href="/jobs" className="font-medium text-accent hover:underline">Browse open vacancies</Link></p>
      </div>
    </>
  );
}
