import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ShareButton } from "@/components/job-tools";
import { absoluteUrl, INDEPENDENCE_NOTE, jsonLd, siteConfig } from "@/lib/site";

export type GuideSection = { id: string; title: string; body: React.ReactNode };
export type GuideLink = { label: string; href: string };

/** When the facts on the guides were last checked against their official sources. */
export const GUIDES_CHECKED = "16 November 2026";
export const GUIDES_CHECKED_ISO = "2026-11-16";

/**
 * The layout every guide under /guides shares: title and intro, "On this page", the sections, open
 * vacancies that match the guide, the official sources it is based on (with the date they were
 * checked) and Article structured data for search engines. Guides state general rules only and link
 * the organizations' own pages; each organization's current terms always decide.
 */
export function GuideLayout({
  path,
  title,
  crumb,
  description,
  intro,
  sections,
  vacancies,
  sources,
  before,
  parent,
}: {
  path: string;
  title: string;
  crumb: string;
  description: string;
  intro: string;
  sections: GuideSection[];
  vacancies: GuideLink[];
  sources: GuideLink[];
  /** Shown above the sections (a tool or a table the guide is built around). */
  before?: React.ReactNode;
  /** A guide this one sits under (a duty station's page under the local salaries guide), for the breadcrumbs. */
  parent?: GuideLink;
}) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    dateModified: GUIDES_CHECKED_ISO,
    mainEntityOfPage: absoluteUrl(path),
    author: { "@type": "Organization", name: siteConfig.name, url: absoluteUrl("/") },
    publisher: { "@type": "Organization", name: siteConfig.operator.name },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <PageHeader
        width="max-w-3xl"
        title={title}
        crumbs={[{ href: "/", label: "Home" }, { href: "/resources", label: "Resources" }, ...(parent ? [parent] : []), { href: path, label: crumb }]}
        intro={intro}
        note={INDEPENDENCE_NOTE}
      />
      <div className="mx-auto max-w-3xl px-4 py-10 text-[1.05rem] leading-relaxed text-ink sm:px-6">
        <div className="mb-6">
          <ShareButton url={absoluteUrl(path)} title={title} />
        </div>
        {before ? <div className="mb-10">{before}</div> : null}
        {sections.length > 2 ? (
          <nav aria-label="On this page" className="rounded-xl border border-rule bg-paper p-5 text-[0.95rem]">
            <p className="text-sm font-semibold text-slate">On this page</p>
            <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {sections.map((s) => (
                <li key={s.id}><a href={`#${s.id}`} className="text-accent hover:underline">{s.title}</a></li>
              ))}
            </ul>
          </nav>
        ) : null}
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-24 space-y-3 [&_a]:text-accent [&_a]:underline [&_li]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1.5">
            <h2 id={`${s.id}-h`} className="text-2xl font-semibold leading-tight">{s.title}</h2>
            {s.body}
          </section>
        ))}
        <section aria-labelledby="vacancies-h" className="mt-12 rounded-xl border border-rule bg-paper p-5">
          <h2 id="vacancies-h" className="text-xl font-semibold">Open vacancies</h2>
          <ul className="mt-2 space-y-1.5">
            {vacancies.map((v) => (
              <li key={v.href}><Link href={v.href} className="font-medium text-accent underline">{v.label}</Link></li>
            ))}
          </ul>
          <p className="mt-3 text-[0.95rem] text-tint-ink">
            <Link href="/alerts" className="font-semibold text-accent underline">Get new matches by email</Link>, so you see them while there is still time to apply.
          </p>
        </section>
        <section aria-labelledby="sources-h" className="mt-10 text-[0.95rem]">
          <h2 id="sources-h" className="text-lg font-semibold">Official sources</h2>
          <p className="mt-1 text-sm text-slate">
            Checked on {GUIDES_CHECKED}. Rules and figures change, so the organization&apos;s own page always decides.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {sources.map((s) => (
              <li key={s.href}><a href={s.href} rel="noopener" className="text-accent underline">{s.label}</a></li>
            ))}
          </ul>
        </section>
        <p className="mt-10 text-[0.95rem]">
          <Link href="/resources" className="text-accent underline">More guides and resources</Link>
        </p>
      </div>
    </>
  );
}
