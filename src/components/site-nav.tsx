"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isMetaVisit, META_VISIT_QUERY } from "@/lib/ad-visit";

export type NavItem = { href: string; label: string };

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Open/closed state for a menu that closes on Escape, on a tap or click outside it and when the
 * page changes (the state remembers the page it was opened on, so a new page starts closed).
 */
function useMenu() {
  const pathname = usePathname() ?? "";
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpenOn(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenOn(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { pathname, open, toggle: () => setOpenOn(open ? null : pathname), close: () => setOpenOn(null), root, trigger };
}

const chevron = (open: boolean) => (
  <svg viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
    <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

/**
 * "Find jobs" in the desktop header: the link goes to all jobs (and works without JavaScript);
 * the arrow beside it opens the employer-type pages.
 */
export function FindJobsMenu({ employers }: { employers: NavItem[] }) {
  const { pathname, open, toggle, close, root, trigger } = useMenu();
  const panelId = useId();
  const active = isActive(pathname, "/jobs") || employers.some((e) => isActive(pathname, e.href));
  return (
    <div ref={root} className="relative flex items-center">
      <Link
        href="/jobs"
        aria-current={pathname === "/jobs" ? "page" : undefined}
        // As tall as the header, so the underline sits at its bottom edge, inside it (see NavLink).
        className={`relative flex h-[72px] items-center pl-1 text-[0.95rem] font-medium transition-colors ${
          active ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:bg-brand" : "text-ink/65 hover:text-ink"
        }`}
      >
        Find jobs
      </Link>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Browse jobs by employer"
        onClick={toggle}
        className={`ml-0.5 flex h-8 w-7 items-center justify-center rounded-md ${active ? "text-ink" : "text-ink/65"} hover:bg-mist hover:text-ink`}
      >
        {chevron(open)}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 top-full z-50 -mt-2 w-max min-w-60 max-w-80 rounded-xl border border-rule bg-paper p-2 shadow-[0_16px_40px_-16px_rgba(11,27,63,0.35)]"
      >
        <Link href="/jobs" onClick={close} className="block rounded-lg px-3 py-2 text-[0.95rem] font-medium text-ink hover:bg-mist">All jobs</Link>
        <p className="mt-1 border-t border-rule px-3 pb-1 pt-2.5 text-xs font-semibold text-slate">Browse by employer</p>
        <ul>
          {employers.map((e) => (
            <li key={e.href}>
              <Link
                href={e.href}
                onClick={close}
                aria-current={isActive(pathname, e.href) ? "page" : undefined}
                className="block rounded-lg px-3 py-2 text-[0.95rem] text-ink hover:bg-mist aria-[current=page]:font-semibold"
              >
                {e.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The alerts button in the header, marked when you are on /alerts. On a page reached from a Meta
 * ad (the tag is in the address) it opens /alerts with the same tag, so that visitor keeps seeing
 * the free weekly email only.
 */
export function AlertsButton({ className, children }: { className: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const here = isActive(pathname, "/alerts");
  const keepAdTag = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (!isMetaVisit(Object.fromEntries(new URLSearchParams(window.location.search)))) return;
    e.preventDefault();
    router.push(`/alerts?${META_VISIT_QUERY}`);
  };
  return (
    // Marked like the other header links: the brand underline at the header's bottom edge (inside it), not a ring.
    // The wrapper is as tall as the header, so the underline never hangs below the sticky header.
    <span className={`relative flex h-[72px] items-center ${here ? "after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:bg-brand" : ""}`}>
      <Link href="/alerts" onClick={keepAdTag} aria-current={here ? "page" : undefined} className={className}>
        {children}
      </Link>
    </span>
  );
}

/** Phone menu: the main links, the employer-type pages and a few more, without repeating the alerts button beside it. */
export function MobileMenu({ main, employers, more }: { main: NavItem[]; employers: NavItem[]; more: NavItem[] }) {
  const { pathname, open, toggle, close, root, trigger } = useMenu();
  const panelId = useId();
  const item = (n: NavItem) => (
    <li key={n.href}>
      <Link
        href={n.href}
        onClick={close}
        aria-current={isActive(pathname, n.href) ? "page" : undefined}
        className="block rounded-lg px-3 py-2.5 text-ink hover:bg-mist aria-[current=page]:bg-mist aria-[current=page]:font-semibold"
      >
        {n.label}
      </Link>
    </li>
  );
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex min-h-11 items-center gap-1.5 rounded-lg border border-rule px-3 py-2 text-sm font-medium text-ink"
      >
        Menu {chevron(open)}
      </button>
      <nav
        id={panelId}
        hidden={!open}
        aria-label="Main (mobile)"
        className="absolute right-0 z-40 mt-2 max-h-[calc(100dvh-5.5rem)] w-64 overflow-y-auto rounded-xl border border-rule bg-paper p-2 shadow-[0_16px_40px_-16px_rgba(11,27,63,0.35)]"
      >
        <ul>{main.map(item)}</ul>
        <p className="mt-1 border-t border-rule px-3 pb-1 pt-2.5 text-xs font-semibold text-slate">Browse by employer</p>
        <ul>{employers.map(item)}</ul>
        <ul className="mt-1 border-t border-rule pt-1">{more.map(item)}</ul>
      </nav>
    </div>
  );
}
