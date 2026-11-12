/**
 * The visitor's country as a two-letter code, from the hosting platform's geolocation headers
 * (Netlify's x-nf-geo, then the headers other hosts and CDNs set). Null when unknown.
 */
function netlifyCountry(raw: string): string | null {
  const attempts = [raw.trim()];
  try {
    attempts.push(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    /* not base64 */
  }
  for (const text of attempts) {
    if (!text.startsWith("{")) continue;
    try {
      // Netlify's x-nf-geo: { city, country: { code, name }, subdivision: { code, name }, timezone, ... }.
      const geo = JSON.parse(text) as { country?: { code?: unknown } };
      if (typeof geo.country?.code === "string") return geo.country.code;
    } catch {
      /* try the next form */
    }
  }
  return null;
}

export function countryFromHeaders(h: Headers): string | null {
  const nf = h.get("x-nf-geo");
  const raw = (nf ? netlifyCountry(nf) : null) || h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry");
  const v = raw?.trim().toUpperCase() ?? "";
  // "XX"/"T1" are "unknown"/"Tor" placeholders used by some CDNs.
  return /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1" ? v : null;
}
