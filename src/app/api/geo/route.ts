/**
 * The visitor's country (from the hosting platform's geolocation headers) and
 * whether we ask for an ad-consent choice there before anything is stored. Lets pages stay
 * static while the consent notice is decided in the browser.
 *
 * Response: { "country": string | null, "consentRequired": boolean }
 */
import { countryFromHeaders } from "@/lib/visitor-country";

export const dynamic = "force-dynamic";

/**
 * Whether to ask before anything optional is stored or loaded: everywhere except the United
 * States, and when the country is unknown. In the United States it runs unless the visitor opts
 * out, and a Global Privacy Control signal counts as opting out (src/components/ads.tsx).
 */
function consentRequiredFor(country: string | null): boolean {
  return country !== "US";
}

export function GET(req: Request) {
  const country = countryFromHeaders(req.headers);
  return Response.json({ country, consentRequired: consentRequiredFor(country) }, { headers: { "cache-control": "private, no-store" } });
}
