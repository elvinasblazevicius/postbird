import Link from "next/link";
import { ORG_TYPES } from "@/config/regions";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { employerTypeCounts } from "@/lib/jobs";
import { siteConfig } from "@/lib/site";
import { BrandMark } from "./brand-mark";
import { SavedCount } from "./job-tools";
import { NavLink } from "./nav-link";
import { AlertsButton, FindJobsMenu, MobileMenu, type NavItem } from "./site-nav";

/** Header links after "Find jobs" (which has its own menu of employer types). */
const NAV = [
  { href: "/remote-jobs", label: "Remote jobs" },
  { href: "/organizations", label: "Organizations" },
  { href: "/pricing", label: "Pricing" },
];

/** The employer-type pages (also in the footer). */
export const EMPLOYER_NAV = EMPLOYER_TYPE_PAGES.map((p) => ({ href: p.path, label: p.label }));

/**
 * The employer-type pages that have open vacancies, for the menus and the footer (a page with none
 * stays reachable from /organizations and its own address). All of them while the site is being
 * built (static pages are built without the database) or when the count can't be read.
 */
export async function employerNav(): Promise<NavItem[]> {
  if (process.env.NEXT_PHASE === "phase-production-build") return EMPLOYER_NAV;
  const counts = await employerTypeCounts().catch(() => null);
  if (!counts) return EMPLOYER_NAV;
  return EMPLOYER_TYPE_PAGES.filter((p) => (counts.get(ORG_TYPES.find((o) => o.value === p.orgtype)?.type ?? "") ?? 0) > 0).map((p) => ({ href: p.path, label: p.label }));
}

export async function SiteHeader() {
  const employers = await employerNav();
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 md:gap-6">
        <Link href="/" className="group flex items-center gap-3 text-ink no-underline" aria-label={`${siteConfig.name} home`}>
          <BrandMark className="h-9 w-9 shrink-0" />
          <span className="font-display text-[1.3rem] font-semibold leading-none tracking-[-0.015em]">{siteConfig.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          <FindJobsMenu employers={employers} />
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>{n.label}</NavLink>
          ))}
          <SavedCount className="-mx-2 px-2" />
          <span className="h-6 w-px bg-rule" aria-hidden="true" />
          {/* Secondary (outline), so blue stays the one colour of primary actions. */}
          <AlertsButton className="rounded-lg border border-rule bg-paper px-4 py-2 text-[0.95rem] font-semibold text-ink hover:border-ink/40 hover:bg-mist">
            Get email alerts
          </AlertsButton>
        </nav>

        <div className="flex items-center gap-1.5 md:hidden">
          <SavedCount className="px-1.5" />
          <AlertsButton className="whitespace-nowrap rounded-lg border border-rule bg-paper px-3 py-2 text-sm font-semibold text-ink hover:bg-mist">Email alerts</AlertsButton>
          <MobileMenu
            main={[{ href: "/jobs", label: "Find jobs" }, ...NAV]}
            employers={employers}
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
