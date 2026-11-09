/**
 * The homepage headline, tagline, description and share image and the
 * /pricing/trial description name the EU only while EU institutions have open
 * vacancies here (server only). Site-wide defaults never name it.
 * Read from the same shared count snapshot as the page's filters
 * (orgTypeFacets in src/lib/jobs.ts), so it costs no extra query.
 */
import siteConfig from "@site-config";
import { orgTypeFacets } from "@/lib/jobs";

/** Whether any EU institution has an open vacancy on the site. False if the count can't be read. */
export async function euListingsOpen(): Promise<boolean> {
  try {
    return ((await orgTypeFacets()).find((t) => t.value === "eu")?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** The homepage wording, with or without the EU. */
export function homeCopy(eu: boolean): { headline: string; subheadline: string; tagline: string; description: string } {
  return eu
    ? { headline: siteConfig.home.headline, subheadline: siteConfig.home.subheadline, tagline: siteConfig.tagline, description: siteConfig.description }
    : siteConfig.home.withoutEu;
}

/**
 * The site's default title and description (root layout, share previews). Always without the EU:
 * pages that don't set their own are often built once at deploy time, so a default naming the EU
 * could outlive the last EU vacancy. The homepage and its share image check at request time.
 */
export const defaultSiteCopy = () => homeCopy(false);

/** "UN, EU and international organization" or "UN and international organization" (before "vacancies"). */
export const employersPhrase = (eu: boolean) => (eu ? "UN, EU and international organization" : "UN and international organization");
