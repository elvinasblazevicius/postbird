/**
 * Which Amazon store to send a visitor to, by country: the stores that list KDP books (the owner
 * checked the book's page on the Belgian and German stores). A country without its own store goes
 * to the store that usually delivers there (amazon.de for the rest of Europe), everyone else to
 * amazon.com.
 */
const STORE_BY_COUNTRY: Record<string, string> = {
  US: "amazon.com",
  GB: "amazon.co.uk",
  IE: "amazon.co.uk",
  DE: "amazon.de", AT: "amazon.de", CH: "amazon.de", LU: "amazon.de", LI: "amazon.de",
  FR: "amazon.fr", MC: "amazon.fr",
  IT: "amazon.it", SM: "amazon.it", VA: "amazon.it", MT: "amazon.it",
  ES: "amazon.es", PT: "amazon.es", AD: "amazon.es",
  NL: "amazon.nl",
  BE: "amazon.com.be",
  PL: "amazon.pl",
  SE: "amazon.se",
  CA: "amazon.ca",
  AU: "amazon.com.au", NZ: "amazon.com.au",
  JP: "amazon.co.jp",
};

/** The rest of the EU and its neighbours: amazon.de delivers there. */
const REST_OF_EUROPE = new Set(["BG", "HR", "CY", "CZ", "DK", "EE", "FI", "GR", "HU", "LV", "LT", "RO", "SK", "SI", "NO", "IS"]);

export function amazonStoreFor(country: string | null | undefined): string {
  const c = (country ?? "").toUpperCase();
  return STORE_BY_COUNTRY[c] ?? (REST_OF_EUROPE.has(c) ? "amazon.de" : "amazon.com");
}

/** The book's page on the visitor's Amazon store. */
export function amazonBookUrl(asin: string, country: string | null | undefined): string {
  return `https://www.${amazonStoreFor(country)}/dp/${asin}`;
}
