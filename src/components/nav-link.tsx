"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header link that marks the section you're in. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // As tall as the header, so the underline sits at its bottom edge, inside it (never below the sticky header).
      className={`relative flex h-[72px] items-center px-1 text-[0.95rem] font-medium transition-colors ${
        active ? "text-ink after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:bg-brand" : "text-ink/65 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
