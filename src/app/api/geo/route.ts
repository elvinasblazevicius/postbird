/**
 * The visitor's country (from the hosting platform's geolocation headers) and
 * whether Microsoft requires an ad-consent choice there. Lets pages stay
 * static while the consent notice is decided in the browser.
 *
 * Response: { "country": string | null, "consentRequired": boolean }
 */
export const dynamic = "force-dynamic";

// EU27 + Iceland, Liechtenstein, Norway (EEA), plus the UK and Switzerland.
const CONSENT_COUNTRIES = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "),
);

function parseNetlifyGeo(raw: string): string | null {
  const attempts = [raw.trim()];
  try {
    attempts.push(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    /* not base64 */
  }
  for (const text of attempts) {
    if (!text.startsWith("{")) continue;
    try {
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
  const raw = (nf ? parseNetlifyGeo(nf) : null) || h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry");
  const code = raw?.trim().toUpperCase() ?? "";
  // "XX"/"T1" are "unknown"/"Tor" placeholders used by some CDNs.
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

export function GET(req: Request) {
  const country = countryFromHeaders(req.headers);
  // Unknown country: ask for consent, to be safe.
  const consentRequired = !country || CONSENT_COUNTRIES.has(country);
  return Response.json({ country, consentRequired }, { headers: { "cache-control": "private, no-store" } });
}
