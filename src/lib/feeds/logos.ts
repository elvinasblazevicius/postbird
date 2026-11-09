/**
 * Organization icons. Fetched on the server during a sync (never by visitors'
 * browsers), stored in the database and served from /api/org-logo/<slug>.
 * The icon comes from Google's public favicon service for the organization's
 * own website; small or missing icons are ignored and the site shows the
 * organization's initials instead. Organizations with logo_blocked = true
 * (for example because the organization objected) are never fetched.
 * Protected emblems are never fetched, stored or served either, so these
 * organizations always show initials:
 *  - UN system organizations and EU institutions (UN and EU rules on the use
 *    of their emblems);
 *  - the Red Cross and Red Crescent Movement: the ICRC, the IFRC and the
 *    national societies (the emblems are protected by the Geneva Conventions),
 *    recognised by name or by website (see EMBLEM_NAME_RE, EMBLEM_DOMAIN_RE).
 */
import { sql } from "@/lib/db";

/** Organization types whose emblem is never fetched, stored or served. */
export const NO_LOGO_ORG_TYPES = ["UN system", "EU institution"] as const;

/**
 * Names of Red Cross and Red Crescent organizations (the ICRC, the IFRC and national societies,
 * in the languages most of them use). Case-insensitive; the same pattern runs in JavaScript and
 * in PostgreSQL (~*), so it uses only syntax both understand.
 */
export const EMBLEM_NAME_RE = [
  "red ?cross", "red ?crescent", "red crystal", "icrc", "ifrc",
  "croix[- ]?rouge", "croissant[- ]?rouge", "cruz roja", "media luna roja", "cruz vermelha", "crescente vermelho",
  "croce rossa", "rote[sn]? ?kreuz", "rode ?kruis", "r[oøö]de ?kors", "punainen risti", "czerwony krzy",
  "crveni kri", "[čc]erven[ýy] k[řr]", "kızılay", "kizilay", "magen david adom",
].join("|");

/** Websites of the same organizations (icrc.org, ifrc.org and national societies' sites). */
export const EMBLEM_DOMAIN_RE = [
  "icrc\\.org", "ifrc\\.org", "redcross", "redcrescent", "croix-?rouge", "cruzroja", "cruzvermelha", "crocerossa",
  "rotkreuz", "rodekruis", "r[oø]e?dekors", "drk\\.de", "kizilay",
].join("|");

const nameRe = new RegExp(EMBLEM_NAME_RE, "i");
const domainRe = new RegExp(EMBLEM_DOMAIN_RE, "i");

/** Whether this organization's emblem must never be fetched, stored or served. Pure, so it is unit-tested. */
export function isLogoProtected(o: { name?: string | null; short_name?: string | null; org_type?: string | null; website?: string | null; domains?: readonly string[] }): boolean {
  if (o.org_type && (NO_LOGO_ORG_TYPES as readonly string[]).includes(o.org_type)) return true;
  if ([o.name, o.short_name].some((n) => n && nameRe.test(n))) return true;
  return [o.website, ...(o.domains ?? [])].some((d) => d && domainRe.test(d));
}

/**
 * The same rule in SQL, for the organizations row `alias` (e.g. "o", or "organizations" when the
 * query has no alias): true when its emblem is protected.
 */
export const logoProtectedSql = (alias: string) => {
  const t = sql(alias);
  return sql`(coalesce(${t}.org_type, '') = any(${[...NO_LOGO_ORG_TYPES]})
    or concat_ws(' ', ${t}.name, ${t}.short_name) ~* ${EMBLEM_NAME_RE}
    or coalesce(${t}.website, '') ~* ${EMBLEM_DOMAIN_RE})`;
};

/**
 * Removes any stored icon of an organization whose emblem is protected (e.g. stored before this
 * rule, or for an organization whose type or name changed). Run by every scheduled import.
 */
export async function clearProtectedLogos(): Promise<number> {
  const rows = await sql`
    update organizations set logo = null, logo_type = null
    where logo is not null and ${logoProtectedSql("organizations")}
    returning id`;
  return rows.length;
}

const MIN_SIZE = 32; // px; smaller icons look blurry in the badge
const PER_RUN = 15; // keep each sync short
const RECHECK_MISSING_DAYS = 30;
const REFRESH_DAYS = 90;

/** Width and height of a PNG, or null if the bytes are not a PNG. */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

async function fetchIcon(domain: string, timeoutMs: number): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; job-listing-icon-fetcher)" },
    });
    if (!res.ok) return null; // 404 = no icon (the service would return a generic globe)
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 100_000) return null;
    const size = pngSize(buf);
    return size && Math.min(size.width, size.height) >= MIN_SIZE ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch icons for organizations that have a website but no (recent) icon check. Returns how many were saved. */
export async function refreshOrgLogos(timeLeftMs: () => number): Promise<number> {
  await clearProtectedLogos();
  const orgs = await sql<{ id: number; name: string; short_name: string | null; org_type: string | null; website: string }[]>`
    select id, name, short_name, org_type, website from organizations
    where website is not null and not logo_blocked
      and not ${logoProtectedSql("organizations")}
      and (
      logo_checked_at is null
      or (logo is null and logo_checked_at < now() - make_interval(days => ${RECHECK_MISSING_DAYS}))
      or logo_checked_at < now() - make_interval(days => ${REFRESH_DAYS}))
    order by logo_checked_at nulls first
    limit ${PER_RUN}`;
  let saved = 0;
  for (const o of orgs) {
    const left = timeLeftMs();
    if (left < 2000) break;
    if (isLogoProtected(o)) continue; // checked in SQL too; never fetched
    const icon = await fetchIcon(o.website, Math.min(5000, left - 1000));
    if (icon) saved++;
    await sql`
      update organizations set logo = coalesce(${icon ? Buffer.from(icon) : null}::bytea, logo),
        logo_type = coalesce(${icon ? "image/png" : null}::text, logo_type), logo_checked_at = now()
      where id = ${o.id} and not logo_blocked and not ${logoProtectedSql("organizations")}`;
  }
  return saved;
}
