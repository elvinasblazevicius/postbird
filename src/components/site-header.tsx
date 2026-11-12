import Link from "next/link";
import { ORG_TYPES } from "@/config/regions";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { employerTypeCounts } from "@/lib/jobs";
import { siteConfig } from "@/lib/site";
import { BrandMark } from "./brand-mark";
import { SavedCount } from "./job-tools";
import { NavLink } from "./nav-link";
import { AlertsButton, FindJobsMenu, MobileMenu, type NavItem } from "./site-nav";

/** The header's one yellow button. It opens /alerts, where the visitor picks the free weekly email or daily alerts. */
const ALERTS_LABEL = "Get job alerts";

/** Header links after "Find jobs" (which has its own menu of employer types). */
const NAV = [
  { href: "/remote-jobs", label: "Remote jobs" },
  { href: "/organizations", label: "Organizations" },
  { href: "/pricing", label: "Pricing" },
];

/**
 * The employer types shown when the counts can't be checked: while the site is being built (static
 * pages are built without the database; they are rendered again within the hour, see `revalidate`
 * on those pages) or when the count can't be read. Only the broad types that always have vacancies
 * here: never EU institutions or development banks, which can have none.
 */
export const UNCHECKED_EMPLOYER_NAV = EMPLOYER_TYPE_PAGES.filter((p) => p.orgtype === "un" || p.orgtype === "ngo" || p.orgtype === "io").map((p) => ({ href: p.path, label: p.label }));

/**
 * The employer-type pages that have open vacancies, for the menus and the footer (a page with none
 * stays reachable from /organizations and its own address); UNCHECKED_EMPLOYER_NAV when the counts
 * can't be read.
 */
export async function employerNav(): Promise<NavItem[]> {
  if (process.env.NEXT_PHASE === "phase-production-build") return UNCHECKED_EMPLOYER_NAV;
  const counts = await employerTypeCounts().catch(() => null);
  if (!counts) return UNCHECKED_EMPLOYER_NAV;
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

        <nav aria-label="Main" className="hidden items-center gap-4 whitespace-nowrap md:flex lg:gap-6">
          <FindJobsMenu employers={employers} />
          {NAV.map((n) => (
            // Tablet widths: "Remote jobs" gives way (it is in the footer and the filters), so the
            // header stays on one line and never scrolls sideways.
            <span key={n.href} className={n.href === "/remote-jobs" ? "max-lg:hidden" : undefined}>
              <NavLink href={n.href}>{n.label}</NavLink>
            </span>
          ))}
          <SavedCount className="-mx-2 px-2" />
          <span className="h-6 w-px bg-rule max-lg:hidden" aria-hidden="true" />
          {/* The one yellow button in the header: alerts are what a first-time visitor is asked for. */}
          <AlertsButton className="whitespace-nowrap rounded-lg bg-highlight px-3 py-2 text-[0.95rem] font-semibold text-ink shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)] hover:brightness-95 lg:px-4">
            {ALERTS_LABEL}
          </AlertsButton>
        </nav>

        <div className="flex items-center gap-1 min-[360px]:gap-1.5 md:hidden">
          <SavedCount className="px-1.5" />
          {/* Below 360px wide (e.g. 320px phones) an envelope with the same name for screen readers, so the header never scrolls sideways. */}
          <AlertsButton className="inline-flex items-center whitespace-nowrap rounded-lg bg-highlight px-2.5 py-2 text-sm font-semibold text-ink hover:brightness-95 min-[360px]:px-3">
            <svg viewBox="0 0 20 20" className="h-5 w-5 min-[360px]:hidden" aria-hidden="true">
              <path d="M3 5.5h14v9H3z M3.5 6l6.5 5 6.5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span className="max-[359.98px]:sr-only">{ALERTS_LABEL}</span>
          </AlertsButton>
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
