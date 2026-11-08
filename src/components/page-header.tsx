import Link from "next/link";
import { absoluteUrl, jsonLd } from "@/lib/site";

export type Crumb = { href: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, item: absoluteUrl(c.href) })),
  };
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-slate">
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((c, i) => (
            <li key={c.href} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {i === items.length - 1 ? (
                <span aria-current="page" className="text-ink">{c.label}</span>
              ) : (
                <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </>
  );
}

export function PageHeader({ title, intro, crumbs, children }: { title: string; intro?: React.ReactNode; crumbs?: Crumb[]; children?: React.ReactNode }) {
  return (
    <header className="bg-candy-soft border-b border-rule">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {crumbs ? <Breadcrumbs items={crumbs} /> : null}
        <h1 className="mt-3 text-[2.1rem] font-semibold leading-tight text-ink sm:text-[2.5rem]">{title}</h1>
        {intro ? <div className="mt-3 max-w-3xl text-[1.05rem] leading-relaxed text-slate">{intro}</div> : null}
        {children}
      </div>
    </header>
  );
}
