/**
 * Whether a visit came from a Meta (Facebook or Instagram) ad: the campaign tag in any spelling
 * (utm_source=meta, Facebook, ig, ...), or the click id Meta adds to its ad links (fbclid). Those
 * visitors came for the free weekly email, so /alerts doesn't show them the paid offer.
 */
const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig"]);

export function isMetaVisit(params: Record<string, string | string[] | undefined>): boolean {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return META_SOURCES.has(first(params.utm_source).trim().toLowerCase()) || first(params.fbclid) !== "";
}

/** The query string that keeps a Meta visit marked on this site's own links ("" for other visits). */
export const META_VISIT_QUERY = "utm_source=meta";
