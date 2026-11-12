import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { CookieSettingsLink } from "./ads";
import { BrandMark } from "./brand-mark";
import { employerNav } from "./site-header";

export async function SiteFooter() {
  const year = new Date().getFullYear();
  const employers = await employerNav();
  return (
    <footer className="mt-24 border-t border-rule bg-mist">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
            <BrandMark className="h-6 w-6" />
            <span className="font-display text-lg font-semibold">{siteConfig.name}</span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate">{siteConfig.disclaimer}</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-slate">
            {siteConfig.name} is run by {siteConfig.operator.name}, {siteConfig.operator.address}.
            {siteConfig.contactEmail ? (
              <> Contact: <a href={`mailto:${siteConfig.contactEmail}`} className="text-accent underline">{siteConfig.contactEmail}</a></>
            ) : null}
          </p>
        </div>
        <nav aria-label="Browse" className="text-sm">
          <h2 className="font-sans text-sm font-semibold text-ink">Browse</h2>
          <ul className="mt-3 space-y-2 text-slate">
            <li><Link href="/jobs" className="hover:text-ink">All jobs</Link></li>
            <li><Link href="/organizations" className="hover:text-ink">Organizations</Link></li>
            <li><Link href="/categories" className="hover:text-ink">Categories</Link></li>
            <li><Link href="/locations" className="hover:text-ink">Countries</Link></li>
            <li><Link href="/remote-jobs" className="hover:text-ink">Remote and home-based jobs</Link></li>
            <li><Link href="/saved" className="hover:text-ink">Saved jobs</Link></li>
          </ul>
        </nav>
        <nav aria-label="Browse by employer" className="text-sm">
          <h2 className="font-sans text-sm font-semibold text-ink">Browse by employer</h2>
          <ul className="mt-3 space-y-2 text-slate">
            {employers.map((e) => (
              <li key={e.href}><Link href={e.href} className="hover:text-ink">{e.label}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label="About" className="text-sm">
          <h2 className="font-sans text-sm font-semibold text-ink">About</h2>
          <ul className="mt-3 space-y-2 text-slate">
            <li><Link href="/about" className="hover:text-ink">How it works</Link></li>
            <li><Link href="/grades" className="hover:text-ink">Grades explained</Link></li>
            <li><Link href="/guides/how-to-read-a-un-vacancy" className="hover:text-ink">How to read a UN vacancy</Link></li>
            <li><Link href="/alerts" className="hover:text-ink">Job alerts</Link></li>
            <li><Link href="/pricing" className="hover:text-ink">Pricing</Link></li>
            <li><Link href="/privacy" className="hover:text-ink">Privacy</Link></li>
            <li><Link href="/terms" className="hover:text-ink">Terms</Link></li>
            <li><Link href="/refunds" className="hover:text-ink">Refunds</Link></li>
            <li><Link href="/account/login" className="hover:text-ink">Manage or cancel a subscription</Link></li>
            {siteConfig.contactEmail ? (
              <li><a href={`mailto:${siteConfig.contactEmail}`} className="hover:text-ink">Contact</a></li>
            ) : null}
            <li><CookieSettingsLink className="text-left hover:text-ink" /></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-rule">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-slate sm:px-6">
          {/* The disclaimer above already says where applications are made; this line doesn't repeat it. */}
          © {year} {siteConfig.operator.name}. Vacancy details belong to the organizations that publish them.
        </p>
      </div>
    </footer>
  );
}
