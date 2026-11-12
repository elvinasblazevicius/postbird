"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar along the top of the window while the next page loads, so a click is answered at
 * once even when the page itself takes a moment. It starts when a link to another page of this
 * site is clicked and ends when the address has changed (the new page is on screen). The bar is
 * drawn by CSS from `data-navigating` on <html> (globals.css); the filter form shows it too
 * (`data-filtering`, src/components/auto-submit.tsx). Wrap in <Suspense> (it reads the query string).
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";

  // The address changed: the page asked for is showing.
  useEffect(() => {
    document.documentElement.removeAttribute("data-navigating");
  }, [pathname, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let to: URL;
      try { to = new URL(a.href, location.href); } catch { return; }
      if (to.origin !== location.origin) return;
      if (to.pathname === location.pathname && to.search === location.search) return; // same page (or just a #part)
      if (to.pathname.startsWith("/api/")) return; // a file to download, not a page
      document.documentElement.setAttribute("data-navigating", "");
      clearTimeout(timer);
      // Never left running: a cancelled or failed navigation ends the bar by itself.
      timer = setTimeout(() => document.documentElement.removeAttribute("data-navigating"), 12_000);
    };
    // In the capture phase: the site's own links cancel the browser's navigation (they load the page
    // in the background), which would otherwise look like "nothing to wait for" from here.
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); clearTimeout(timer); };
  }, []);
  return null;
}
