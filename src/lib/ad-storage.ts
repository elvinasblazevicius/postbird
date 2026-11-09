/**
 * What "No thanks" to advertising cookies removes from the visitor's device
 * (used by src/components/ads.tsx; pure helpers, so they are unit-tested):
 * Microsoft UET's first-party cookies (_uetsid, _uetvid, _uetmsclkid, and
 * MUID when it was set on this site's domain), UET's copies of them in local
 * and session storage (with their "_exp" entries), and our own campaign
 * attribution (gch_attr).
 */

/** The ad tag's cookie and storage names. */
export const AD_STORAGE_NAMES = ["_uetsid", "_uetvid", "_uetmsclkid", "MUID"] as const;
/** Our first-touch campaign attribution in local storage. */
export const ATTRIBUTION_KEY = "gch_attr";

const isAdName = (name: string) => AD_STORAGE_NAMES.some((n) => name === n || name.startsWith(`${n}_`));

/** The ad cookies present in a document.cookie string (only cookies of this site's domain are visible there). */
export function adCookieNames(cookieString: string): string[] {
  const names = cookieString.split(";").map((c) => c.split("=")[0]?.trim() ?? "").filter(Boolean);
  return [...new Set(names.filter((n) => (AD_STORAGE_NAMES as readonly string[]).includes(n)))];
}

/**
 * The document.cookie assignments that expire one cookie: host-only, and for
 * this host and each parent domain (UET sets its cookies on the top domain,
 * e.g. .example.com from www.example.com). A domain the browser won't accept
 * (a public suffix) is simply ignored by it.
 */
export function expireCookieStrings(name: string, hostname: string): string[] {
  const base = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`;
  const out = [base];
  const host = hostname.replace(/\.$/, "").toLowerCase();
  const labels = host.split(".");
  if (labels.length >= 2 && !/^\d+(\.\d+){3}$/.test(host) && !host.includes(":")) {
    for (let i = 0; i <= labels.length - 2; i++) out.push(`${base}; Domain=.${labels.slice(i).join(".")}`);
  }
  return out;
}

/** The storage keys to remove: the ad tag's entries (e.g. _uetsid, _uetsid_exp) and our attribution. */
export function adStorageKeys(keys: string[]): string[] {
  return keys.filter((k) => k === ATTRIBUTION_KEY || isAdName(k));
}

type CookieJar = { cookie: string };
type KeyStore = Pick<Storage, "length" | "key" | "removeItem">;

/** Removes every ad cookie and storage entry listed above. Never throws. */
export function clearAdStorage(env: { doc: CookieJar; hostname: string; stores: (KeyStore | null)[] }): void {
  try {
    for (const name of adCookieNames(env.doc.cookie)) {
      for (const c of expireCookieStrings(name, env.hostname)) env.doc.cookie = c;
    }
  } catch {
    /* cookies blocked */
  }
  for (const store of env.stores) {
    if (!store) continue;
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k) keys.push(k);
      }
      for (const k of adStorageKeys(keys)) store.removeItem(k);
    } catch {
      /* storage blocked */
    }
  }
}
