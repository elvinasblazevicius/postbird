/**
 * Pay for locally recruited UN staff: General Service (G-1 to G-7) and National Officers (NO-A to
 * NO-E), whose salary scales are set duty station by duty station, in a local or set currency. The
 * figures are in src/lib/local-pay-data.ts; this file holds the types and the lookups.
 */
import { countryByCode } from "@/config/countries";
import { countriesInLocation, normalizePlace } from "@/lib/country-match";
import { LOCAL_PAY_FETCHED, LOCAL_PAY_RATES_DATE, LOCAL_PAY_STATIONS } from "@/lib/local-pay-data";
import { POST_ADJUSTMENT } from "@/lib/un-pay";

export type LocalPayScale = {
  /** When the scale took effect (YYYY-MM-DD), as the UN salary scale site gives it. */
  effective: string;
  /** Annual net salary, first step and highest step (long-service steps included), in the scale's currency. */
  grades: Record<string, [number, number]>;
  /** Who the scale applies to, where the published scale says ("applicable only to staff recruited on or after …"). */
  note?: string;
};

export type LocalPayStation = {
  station: string;
  country: string;
  /** ISO country code, as the site's country pages use. */
  code: string;
  slug: string;
  /** Currency the scale is expressed in, and the one it is paid in (they differ in some countries). */
  currency: string;
  paidIn: string;
  /** The station's scales apply to every duty station in the country. */
  countryWide?: boolean;
  /** Units of the scale's currency per US dollar, at the UN operational rate of exchange (LOCAL_PAY_RATES_DATE); none for USD scales. */
  usdRate?: number;
  gs?: LocalPayScale;
  no?: LocalPayScale;
};

export { LOCAL_PAY_FETCHED, LOCAL_PAY_RATES_DATE, LOCAL_PAY_STATIONS };

/** The UN operational rates of exchange, used to show local amounts in US dollars. */
export const UN_RATES_SOURCE = "https://treasury.un.org/operationalrates/OperationalRates.php";

/** A local amount in US dollars at the UN operational rate, or null when the scale is already in dollars or has no rate. */
export function inUsd(amount: number, s: Pick<LocalPayStation, "currency" | "usdRate">): number | null {
  if (s.currency === "USD" || !s.usdRate) return null;
  return amount / s.usdRate;
}

/** "US$ 6,975" (rounded to the dollar). */
export function usdMoney(amount: number): string {
  return `US$ ${Math.round(amount).toLocaleString("en-US")}`;
}

/** The official source: the UN's salary scale site, which the ICSC points to for local scales. */
export const LOCAL_PAY_SOURCE = "https://onehr.un.org/salary-survey/#/salary_scale";
export const LOCAL_PAY_FAQ = "https://icsc.un.org/Resources/FAQs/where-can-i-find-the-general-s.htm";
export const LOCAL_PAY_PATH = "/guides/un-local-salaries";

export function localPayStation(slug: string): LocalPayStation | undefined {
  return LOCAL_PAY_STATIONS.find((s) => s.slug === slug);
}

/** Stations shown by their own name only, as the ICSC lists them (no country attached). */
const NAME_ONLY = new Set(["Jerusalem"]);

/** "Nairobi, Kenya"; a station named like its country ("Singapore", "Djibouti") once. */
export function stationLabel(s: LocalPayStation): string {
  if (NAME_ONLY.has(s.station)) return s.station;
  return normalizePlace(s.station) === normalizePlace(s.country) ? s.country : `${s.station}, ${s.country}`;
}

/** Whether to link the station to its country's vacancy pages (not for stations shown by name only). */
export function linksToCountry(s: LocalPayStation): boolean {
  return !NAME_ONLY.has(s.station);
}

/** "KES 906,009": the scale's own currency code, since some codes (CFA) cover more than one currency. */
export function money(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}

/** "1 November 2025" from "2025-11-01". */
export function effectiveLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The station whose scales cover a vacancy: the one in its city when the country has several,
 * otherwise the country's only station. Null when the country has none or the city is unclear.
 */
export function localPayForPlace(countryCode: string | null | undefined, city: string | null | undefined): LocalPayStation | null {
  if (!countryCode) return null;
  const inCountry = LOCAL_PAY_STATIONS.filter((s) => s.code === countryCode.toUpperCase());
  if (!inCountry.length) return null;
  const c = city ? normalizePlace(city) : "";
  const byCity = c ? inCountry.find((s) => c.includes(normalizePlace(s.station))) : undefined;
  if (byCity) return byCity;
  return inCountry.length === 1 ? inCountry[0] : null;
}

/** Stations grouped by country name, for pickers and the A to Z list. */
export function stationsByCountry(): { country: string; stations: LocalPayStation[] }[] {
  const groups = new Map<string, LocalPayStation[]>();
  for (const s of LOCAL_PAY_STATIONS) groups.set(s.country, [...(groups.get(s.country) ?? []), s]);
  return [...groups].map(([country, stations]) => ({ country, stations })).sort((a, b) => a.country.localeCompare(b.country));
}

/** The site's country page name for a station, falling back to the scale's own country name. */
export function countryName(s: LocalPayStation): string {
  return countryByCode(s.code)?.name ?? s.country;
}

/** Post adjustment names the country matcher doesn't read on its own. */
const PA_CODES: Record<string, string> = {
  "Slovak Republic": "SK", "Korea, Republic of": "KR", "Korea, Democratic People's Republic of": "KP",
  "Congo, Democratic Republic of the": "CD", Bonaire: "BQ", "Saint Helena": "SH",
};
const compact = (s: string) => normalizePlace(s).replace(/ /g, "");

/** Country codes a post adjustment entry names ("USA, New York" → US; "China, Macao (SAR)" → MO, CN). */
export function postAdjustmentCountries(place: string): string[] {
  return PA_CODES[place] ? [PA_CODES[place]] : countriesInLocation(place);
}

/**
 * The post adjustment entry that covers a duty station: an entry named like the station
 * ("Jerusalem"), the entry naming its city where the circular lists cities ("USA, New York"),
 * otherwise the country's single entry. Null when none fits (a city the circular doesn't list).
 */
export function postAdjustmentForStation(code: string, station: string): { place: string; multiplier: number } | null {
  const city = compact(station);
  const exact = POST_ADJUSTMENT.find((p) => compact(p.place) === city);
  if (exact) return exact;
  const inCountry = POST_ADJUSTMENT.filter((p) => postAdjustmentCountries(p.place).includes(code));
  const named = inCountry.find((p) => {
    if (!p.place.includes(",")) return false;
    const c = compact(p.place.split(",").slice(1).join(" "));
    return c.startsWith(city) || city.startsWith(c);
  });
  if (named) return named;
  return inCountry.length === 1 ? inCountry[0] : null;
}
