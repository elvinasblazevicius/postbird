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

/**
 * Quiet header band at the top of inner pages. `badge` is an optional logo or flag beside the title.
 * `compact`: on phones a smaller title and no intro, so results start near the top (search pages).
 */
export function PageHeader({ title, intro, crumbs, badge, compact = false, children }: { title: string; intro?: React.ReactNode; crumbs?: Crumb[]; badge?: React.ReactNode; compact?: boolean; children?: React.ReactNode }) {
  return (
    <header className="brand-band">
      <div className={`mx-auto max-w-6xl px-4 sm:px-6 ${compact ? "pb-4 pt-4 sm:pb-9 sm:pt-7" : "pb-9 pt-7"}`}>
        {crumbs ? <div className={compact ? "hidden sm:block" : undefined}><Breadcrumbs items={crumbs} /></div> : null}
        <div className={`flex items-center gap-4 ${compact ? "sm:mt-4" : "mt-4"}`}>
          {badge}
          <h1 className={`font-semibold leading-tight text-ink ${compact ? "text-[1.45rem] sm:text-[2.5rem]" : "text-[2rem] sm:text-[2.5rem]"}`}>{title}</h1>
        </div>
        {intro ? <div className={`mt-3 max-w-3xl text-[1.05rem] leading-relaxed text-slate ${compact ? "hidden sm:block" : ""}`}>{intro}</div> : null}
        {children}
      </div>
    </header>
  );
}
