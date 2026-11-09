/**
 * The visitor's country (from the hosting platform's geolocation headers) and
 * whether we ask for an ad-consent choice there before anything is stored. Lets pages stay
 * static while the consent notice is decided in the browser.
 *
 * Response: { "country": string | null, "consentRequired": boolean }
 */
export const dynamic = "force-dynamic";

// EU27 + Iceland, Liechtenstein, Norway (EEA), plus the UK, Switzerland, Türkiye (KVKK),
// South Korea (PIPA) and Brazil (LGPD). Canada: Québec only (Law 25), see consentRequiredFor.
const CONSENT_COUNTRIES = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH TR KR BR".split(" "),
);

/**
 * Whether to ask before anything optional is stored or loaded. Unknown country: ask, to be
 * safe. Canada: ask in Québec, and anywhere in Canada when the province isn't known.
 */
function consentRequiredFor(country: string | null, region: string | null): boolean {
  if (!country) return true;
  if (country === "CA") return region !== null ? region === "QC" : true;
  return CONSENT_COUNTRIES.has(country);
}

type Geo = { country: string | null; region: string | null };

function parseNetlifyGeo(raw: string): Geo | null {
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
      const geo = JSON.parse(text) as { country?: { code?: unknown }; subdivision?: { code?: unknown } };
      if (typeof geo.country?.code === "string") {
        return { country: geo.country.code, region: typeof geo.subdivision?.code === "string" ? geo.subdivision.code : null };
      }
    } catch {
      /* try the next form */
    }
  }
  return null;
}

const code = (raw: string | null | undefined, len: RegExp) => {
  const v = raw?.trim().toUpperCase() ?? "";
  return len.test(v) ? v : null;
};

function geoFromHeaders(h: Headers): Geo {
  const nf = h.get("x-nf-geo");
  const netlify = nf ? parseNetlifyGeo(nf) : null;
  const raw = netlify?.country || h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry");
  // "XX"/"T1" are "unknown"/"Tor" placeholders used by some CDNs.
  const country = code(raw, /^[A-Z]{2}$/);
  const known = country && country !== "XX" && country !== "T1" ? country : null;
  // The province or state: Netlify's subdivision code, or Vercel's region header (ISO 3166-2 suffix).
  const region = code(netlify ? netlify.region : h.get("x-vercel-ip-country-region"), /^[A-Z0-9]{1,3}$/);
  return { country: known, region: known ? region : null };
}

export function GET(req: Request) {
  const { country, region } = geoFromHeaders(req.headers);
  const consentRequired = consentRequiredFor(country, region);
  return Response.json({ country, consentRequired }, { headers: { "cache-control": "private, no-store" } });
}
