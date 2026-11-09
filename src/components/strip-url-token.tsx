"use client";

import { useEffect } from "react";

/**
 * Takes a private token out of the address bar once the page has loaded (the page already holds it
 * in its forms), so it doesn't stay in the browser history, a shared screenshot or a copied link.
 * Only for pages that never need the token in their address again: their server actions take it
 * from the form and don't re-render the page. history.state is kept, so Next's router still works.
 */
export function StripUrlToken({ params }: { params: string[] }) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (!params.some((p) => url.searchParams.has(p))) return;
      for (const p of params) url.searchParams.delete(p);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* never break the page */
    }
  }, [params]);
  return null;
}
