import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";

const NAV = [
  { href: "/jobs", label: "Find jobs" },
  { href: "/remote-jobs", label: "Remote jobs" },
  { href: "/organizations", label: "Organizations" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3 text-ink no-underline" aria-label={`${siteConfig.name} home`}>
          <BrandMark className="h-9 w-9 shrink-0" />
          <span className="font-display text-[1.3rem] font-semibold leading-none tracking-[-0.015em]">{siteConfig.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
          ))}
          <span className="h-6 w-px bg-rule" aria-hidden="true" />
          <Link
            href="/alerts"
            className="rounded-lg bg-highlight px-4 py-2 text-[0.95rem] font-semibold text-ink shadow-[inset_0_-2px_0_rgba(11,27,63,0.12)] hover:brightness-[0.97]"
          >
            Get email alerts
          </Link>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
        <Link href="/alerts" className="rounded-lg bg-highlight px-3 py-2 text-sm font-semibold text-ink">Email alerts</Link>
        <details className="relative">
          <summary className="list-none rounded-lg border border-rule px-3 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <nav aria-label="Main (mobile)" className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-rule bg-paper p-2 shadow-[0_16px_40px_-16px_rgba(11,27,63,0.35)]">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2.5 text-ink hover:bg-mist">
                {n.label}
              </Link>
            ))}
            {[
              { href: "/locations", label: "Countries" },
              { href: "/categories", label: "Categories" },
            ].map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2.5 text-ink hover:bg-mist">
                {n.label}
              </Link>
            ))}
            <Link href="/alerts" className="mt-1 block rounded-lg bg-highlight px-3 py-2.5 font-semibold text-ink">
              Get email alerts
            </Link>
          </nav>
        </details>
        </div>
      </div>
    </header>
  );
}
