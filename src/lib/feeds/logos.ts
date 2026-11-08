/**
 * Organization icons. Fetched on the server during a sync (never by visitors'
 * browsers), stored in the database and served from /api/org-logo/<slug>.
 * The icon comes from Google's public favicon service for the organization's
 * own website; small or missing icons are ignored and the site shows the
 * organization's initials instead.
 */
import { sql } from "@/lib/db";

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
  const orgs = await sql<{ id: number; website: string }[]>`
    select id, website from organizations
    where website is not null and (
      logo_checked_at is null
      or (logo is null and logo_checked_at < now() - make_interval(days => ${RECHECK_MISSING_DAYS}))
      or logo_checked_at < now() - make_interval(days => ${REFRESH_DAYS}))
    order by logo_checked_at nulls first
    limit ${PER_RUN}`;
  let saved = 0;
  for (const o of orgs) {
    const left = timeLeftMs();
    if (left < 2000) break;
    const icon = await fetchIcon(o.website, Math.min(5000, left - 1000));
    if (icon) saved++;
    await sql`
      update organizations set logo = coalesce(${icon ? Buffer.from(icon) : null}::bytea, logo),
        logo_type = coalesce(${icon ? "image/png" : null}::text, logo_type), logo_checked_at = now()
      where id = ${o.id}`;
  }
  return saved;
}
