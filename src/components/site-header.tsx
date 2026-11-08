import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { BrandMark } from "./brand-mark";

const NAV = [
  { href: "/jobs", label: "Find jobs" },
  { href: "/remote-jobs", label: "Remote jobs" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
          <BrandMark className="h-7 w-7 shrink-0" />
          <span className="font-display text-[1.3rem] font-semibold leading-none tracking-tight">{siteConfig.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-[0.95rem] text-slate hover:bg-mist hover:text-ink">
              {n.label}
            </Link>
          ))}
          <Link
            href="/alerts"
            className="ml-2 rounded-md bg-brand px-4 py-2 text-[0.95rem] font-medium text-white hover:bg-accent"
          >
            Get email alerts
          </Link>
        </nav>

        <details className="relative md:hidden">
          <summary className="list-none rounded-md border border-rule px-3 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <nav aria-label="Main (mobile)" className="absolute right-0 z-40 mt-2 w-56 rounded-lg border border-rule bg-paper p-2 shadow-lg">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2.5 text-ink hover:bg-mist">
                {n.label}
              </Link>
            ))}
            <Link href="/alerts" className="mt-1 block rounded-md bg-brand px-3 py-2.5 font-medium text-white">
              Get email alerts
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
