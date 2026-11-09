/**
 * The visitor's country (from the hosting platform's geolocation headers) and
 * whether we ask for an ad-consent choice there before anything is stored. Lets pages stay
 * static while the consent notice is decided in the browser.
 *
 * Response: { "country": string | null, "consentRequired": boolean }
 */
export const dynamic = "force-dynamic";

/**
 * Whether to ask before anything optional is stored or loaded: everywhere except the United
 * States, and when the country is unknown. In the United States it runs unless the visitor opts
 * out, and a Global Privacy Control signal counts as opting out (src/components/ads.tsx).
 */
function consentRequiredFor(country: string | null): boolean {
  return country !== "US";
}

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

function countryFromHeaders(h: Headers): string | null {
  const nf = h.get("x-nf-geo");
  const raw = (nf ? netlifyCountry(nf) : null) || h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry");
  const v = raw?.trim().toUpperCase() ?? "";
  // "XX"/"T1" are "unknown"/"Tor" placeholders used by some CDNs.
  return /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1" ? v : null;
}

export function GET(req: Request) {
  const country = countryFromHeaders(req.headers);
  return Response.json({ country, consentRequired: consentRequiredFor(country) }, { headers: { "cache-control": "private, no-store" } });
}
