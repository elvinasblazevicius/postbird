import Link from "next/link";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { siteConfig } from "@/lib/site";
import { BrandMark } from "./brand-mark";
import { NavLink } from "./nav-link";
import { AlertsButton, FindJobsMenu, MobileMenu } from "./site-nav";

/** Header links after "Find jobs" (which has its own menu of employer types). */
const NAV = [
  { href: "/remote-jobs", label: "Remote jobs" },
  { href: "/organizations", label: "Organizations" },
  { href: "/pricing", label: "Pricing" },
];

/** The employer-type pages, always listed (also in the footer). */
export const EMPLOYER_NAV = EMPLOYER_TYPE_PAGES.map((p) => ({ href: p.path, label: p.label }));

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3 text-ink no-underline" aria-label={`${siteConfig.name} home`}>
          <BrandMark className="h-9 w-9 shrink-0" />
          <span className="font-display text-[1.3rem] font-semibold leading-none tracking-[-0.015em]">{siteConfig.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          <FindJobsMenu employers={EMPLOYER_NAV} />
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
          ))}
          <span className="h-6 w-px bg-rule" aria-hidden="true" />
          {/* Secondary (outline), so blue stays the one colour of primary actions. */}
          <AlertsButton className="rounded-lg border border-rule bg-paper px-4 py-2 text-[0.95rem] font-semibold text-ink hover:border-ink/40 hover:bg-mist">
            Get email alerts
          </AlertsButton>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <AlertsButton className="rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-semibold text-ink hover:bg-mist">Email alerts</AlertsButton>
          <MobileMenu
            main={[{ href: "/jobs", label: "Find jobs" }, ...NAV]}
            employers={EMPLOYER_NAV}
            more={[
              { href: "/locations", label: "Countries" },
              { href: "/categories", label: "Categories" },
              { href: "/saved", label: "Saved jobs" },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
