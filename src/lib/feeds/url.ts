import { createHash } from "node:crypto";

/** Hosts that belong to feed readers/aggregators rather than employers. */
const AGGREGATOR_HOSTS = [/(^|\.)inoreader\.com$/i, /(^|\.)innoreader\.com$/i, /(^|\.)feedproxy\.google\.com$/i, /(^|\.)feedburner\.com$/i];

const TRACKING_PARAMS = /^(utm_[a-z_]+|gclid|fbclid|mc_cid|mc_eid|msclkid|_hsenc|_hsmi|igshid|yclid)$/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isAggregatorUrl(url: string): boolean {
  const h = hostOf(url);
  return AGGREGATOR_HOSTS.some((re) => re.test(h));
}

/** Pick the best application link: the first that is not a feed-reader link. */
export function pickApplyUrl(candidates: string[]): string | null {
  const valid = candidates.filter((u) => {
    try {
      const p = new URL(u).protocol;
      return p === "http:" || p === "https:";
    } catch {
      return false;
    }
  });
  return valid.find((u) => !isAggregatorUrl(u)) ?? valid[0] ?? null;
}

/**
 * Canonical form of a URL for duplicate detection: lower-case host without
 * "www.", no fragment, no tracking parameters, sorted query, no trailing slash.
 */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if ((u.port === "443") || (u.port === "80")) u.port = "";
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
    params.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
    u.search = params.length ? "?" + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
    let path = u.pathname.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    u.pathname = path;
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
