import type { Metadata } from "next";
import Link from "next/link";
import { OrgBadge } from "@/components/job-card";
import { PageHeader } from "@/components/page-header";
import { organizationFacets } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organizations hiring now — UN agencies, international organizations and NGOs",
  description: "Browse open vacancies by employer: UN agencies, international financial institutions, EU bodies, humanitarian organizations and NGOs.",
  alternates: { canonical: "/organizations" },
};

const ORDER = ["UN system", "International financial institution", "EU institution", "International organization", "NGO", "Other organizations"];

export default async function OrganizationsPage() {
  const orgs = [...(await organizationFacets())];
  const groups = new Map<string, typeof orgs>();
  for (const o of orgs) {
    const key = o.org_type ?? "Other organizations";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const sorted = [...groups.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  const heading = (t: string) =>
    t === "UN system" ? "UN system" : t === "Other organizations" ? "Other organizations" : `${t}s`;

  return (
    <>
      <PageHeader
        title="Organizations hiring now"
        crumbs={[{ href: "/", label: "Home" }, { href: "/organizations", label: "Organizations" }]}
        intro={`${orgs.length} organizations currently have open vacancies.`}
      />
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {sorted.map(([type, list]) => (
          <section key={type} aria-labelledby={`g-${type}`}>
            <h2 id={`g-${type}`} className="text-[1.5rem] font-semibold text-ink">{heading(type)}</h2>
            <ul className="mt-4 grid gap-x-8 border-t border-rule sm:grid-cols-2 lg:grid-cols-3">
              {list.map((o) => (
                <li key={o.slug} className="border-b border-rule">
                  <Link href={`/organizations/${o.slug}`} className="flex items-center gap-3 py-3 hover:text-accent">
                    <OrgBadge name={o.name} short={o.short_name} />
                    <span className="flex-1 text-ink">{o.name}</span>
                    <span className="text-sm tabular-nums text-slate">{o.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {orgs.length === 0 ? <p className="text-slate">Organizations appear here once vacancies have been imported.</p> : null}
      </div>
    </>
  );
}
