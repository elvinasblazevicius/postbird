import Link from "next/link";
import { absoluteUrl, jsonLd } from "@/lib/site";

export type Crumb = { href: string; label: string };

export function Breadcrumbs({ items, dark = false }: { items: Crumb[]; dark?: boolean }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, item: absoluteUrl(c.href) })),
  };
  return (
    <>
      <nav aria-label="Breadcrumb" className={`text-sm ${dark ? "text-white/70" : "text-slate"}`}>
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((c, i) => (
            <li key={c.href} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {i === items.length - 1 ? (
                <span aria-current="page" className={dark ? "text-white" : "text-ink"}>{c.label}</span>
              ) : (
                <Link href={c.href} className={dark ? "hover:text-white hover:underline" : "hover:text-ink hover:underline"}>{c.label}</Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </>
  );
}

/** Quiet header band at the top of inner pages. `badge` is an optional logo or flag beside the title. */
export function PageHeader({ title, intro, crumbs, badge, children }: { title: string; intro?: React.ReactNode; crumbs?: Crumb[]; badge?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="brand-band">
      <div className="mx-auto max-w-6xl px-4 pb-9 pt-7 sm:px-6">
        {crumbs ? <Breadcrumbs items={crumbs} /> : null}
        <div className="mt-4 flex items-center gap-4">
          {badge}
          <h1 className="text-[2rem] font-semibold leading-tight text-ink sm:text-[2.5rem]">{title}</h1>
        </div>
        {intro ? <div className="mt-3 max-w-3xl text-[1.05rem] leading-relaxed text-slate">{intro}</div> : null}
        {children}
      </div>
    </header>
  );
}
