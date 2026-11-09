/** Query parameters worth keeping in stored paths (campaign attribution); everything else is dropped. */
const KEEP_PARAM = /^(utm_[a-z_]+|msclkid)$/i;

/**
 * A same-site path with only campaign parameters (utm_*, msclkid) kept.
 * Returns null when the value isn't a path, and false for admin pages and
 * alert links (/alerts/confirm, /alerts/unsubscribe carry email tokens) and the
 * account pages (/account?t= is a private link),
 * which must never be recorded.
 */
export function cleanTrackedPath(path: unknown): string | null | false {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(path, "https://example.invalid");
  } catch {
    return null;
  }
  const p = url.pathname;
  if (p === "/admin" || p.startsWith("/admin/") || p.startsWith("/alerts/") || p === "/account" || p.startsWith("/account/")) return false;
  const kept = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (KEEP_PARAM.test(k)) kept.append(k, v.slice(0, 120));
  const qs = kept.toString();
  return (p + (qs ? `?${qs}` : "")).slice(0, 500);
}
