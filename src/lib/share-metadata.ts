/**
 * A page's share preview (Open Graph and Twitter/X cards): its own title and description, so a
 * shared link doesn't show the site's defaults. Setting openGraph or twitter on a page replaces
 * the root layout's (Next.js merges metadata shallowly), so both are set here in full.
 */
import type { Metadata } from "next";
import siteConfig from "@site-config";

export function shareMetadata(title: string, description: string): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: { type: "website", siteName: siteConfig.name, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** The page title as it appears in the browser (the root layout's "%s | Postbird" template). */
export const sharedTitle = (title: string) => `${title} | ${siteConfig.name}`;
