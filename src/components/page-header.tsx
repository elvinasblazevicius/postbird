import Link from "next/link";
import { absoluteUrl, jsonLd } from "@/lib/site";

export type Crumb = { href: string; label: string };

/**
 * The trail of links above a page title. On phones it is one link back (`back`, or the page above
 * this one: "← Jobs"), so a long trail never wraps over several lines; from the sm breakpoint the whole trail.
 */
export function Breadcrumbs({ items, dark = false, back }: { items: Crumb[]; dark?: boolean; back?: Crumb }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, item: absoluteUrl(c.href) })),
  };
  const up = back ?? (items.length > 1 ? items[items.length - 2] : null);
  const linkCls = dark ? "hover:text-white hover:underline" : "hover:text-ink hover:underline";
  return (
    <>
      <nav aria-label="Breadcrumb" className={`text-sm ${dark ? "text-white/70" : "text-slate"}`}>
        {up ? (
          <p className="sm:hidden">
            <Link href={up.href} className={`inline-flex items-center gap-1 py-1 ${linkCls}`}>
              <span aria-hidden="true">←</span> {up.label}
            </Link>
          </p>
        ) : null}
        <ol className={`flex-wrap items-center gap-1.5 ${up ? "hidden sm:flex" : "flex"}`}>
          {items.map((c, i) => (
            <li key={c.href} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {i === items.length - 1 ? (
                <span aria-current="page" className={dark ? "text-white" : "text-ink"}>{c.label}</span>
              ) : (
                <Link href={c.href} className={linkCls}>{c.label}</Link>
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
 * `width`: the max-width class of the page body below, so the heading and the text share one left
 * edge (prose pages use "max-w-3xl"). `note`: a small line under the intro (e.g. non-affiliation).
 */
export function PageHeader({ title, intro, crumbs, badge, compact = false, width = "max-w-6xl", note, children }: { title: string; intro?: React.ReactNode; crumbs?: Crumb[]; badge?: React.ReactNode; compact?: boolean; width?: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="brand-band">
      <div className={`mx-auto ${width} px-4 sm:px-6 ${compact ? "pb-4 pt-4 sm:pb-9 sm:pt-7" : "pb-9 pt-7"}`}>
        {crumbs ? <div className={compact ? "hidden sm:block" : undefined}><Breadcrumbs items={crumbs} /></div> : null}
        <div className={`flex items-center gap-4 ${compact ? "sm:mt-4" : "mt-4"}`}>
          {badge}
          <h1 className={`font-semibold leading-tight text-ink ${compact ? "text-[1.45rem] sm:text-[2.5rem]" : "text-[2rem] sm:text-[2.5rem]"}`}>{title}</h1>
        </div>
        {intro ? <div className={`mt-3 max-w-3xl text-[1.05rem] leading-relaxed text-slate ${compact ? "hidden sm:block" : ""}`}>{intro}</div> : null}
        {note ? <p className={`max-w-3xl text-sm text-slate ${compact ? "mt-1.5 sm:mt-3" : "mt-3"}`}>{note}</p> : null}
        {children}
      </div>
    </header>
  );
}
