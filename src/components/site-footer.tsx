import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { BrandMark } from "./brand-mark";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-rule bg-mist">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
            <BrandMark className="h-6 w-6" />
            <span className="font-display text-lg font-semibold">{siteConfig.name}</span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate">{siteConfig.disclaimer}</p>
        </div>
        <nav aria-label="Browse" className="text-sm">
          <h2 className="font-sans text-sm font-semibold text-ink">Browse</h2>
          <ul className="mt-3 space-y-2 text-slate">
            <li><Link href="/jobs" className="hover:text-ink">All jobs</Link></li>
            <li><Link href="/organizations" className="hover:text-ink">Organizations</Link></li>
            <li><Link href="/categories" className="hover:text-ink">Categories</Link></li>
            <li><Link href="/locations" className="hover:text-ink">Countries</Link></li>
            <li><Link href="/remote-jobs" className="hover:text-ink">Remote and home-based jobs</Link></li>
          </ul>
        </nav>
        <nav aria-label="About" className="text-sm">
          <h2 className="font-sans text-sm font-semibold text-ink">About</h2>
          <ul className="mt-3 space-y-2 text-slate">
            <li><Link href="/about" className="hover:text-ink">How it works</Link></li>
            <li><Link href="/alerts" className="hover:text-ink">Weekly job alerts</Link></li>
            <li><Link href="/pricing" className="hover:text-ink">Premium alerts</Link></li>
            <li><Link href="/privacy" className="hover:text-ink">Privacy</Link></li>
            <li><Link href="/terms" className="hover:text-ink">Terms</Link></li>
            {siteConfig.contactEmail ? (
              <li><a href={`mailto:${siteConfig.contactEmail}`} className="hover:text-ink">Contact</a></li>
            ) : null}
          </ul>
        </nav>
      </div>
      <div className="border-t border-rule">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-slate sm:px-6">
          © {year} {siteConfig.name}. Vacancy details belong to the organizations that publish them; always check the official posting before applying.
        </p>
      </div>
    </footer>
  );
}
