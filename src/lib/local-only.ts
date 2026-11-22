/**
 * Does a vacancy's own text say it is open only to nationals (or residents) of the duty-station
 * country? For listings whose grade and title don't say so (isLocalOnly in src/lib/grades.ts reads
 * those). Precise on purpose: statements about other groups ("only EU citizens", "nationals of
 * member states only", "nationals of non-represented countries are encouraged") are not this.
 */
import { countryByCode } from "@/config/countries";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wording that makes a post national whatever the country. */
const ANY_COUNTRY = [
  // "National Consultant", "National Communication Consultant", "National Individual Consultant", "national consultancy".
  /\bnational (?:[a-z&/-]+ ){0,3}consultan(?:t|ts|cy)\b/,
  /\bconsultan(?:t|te|tes) national(?:e|es)?\b/,
  /\bconsultor(?:a|es)? nacional(?:es)?\b/,
  /\blocally[- ]recruited (?:post|position|staff|vacancy)\b/,
  /\bthis is a (?:locally recruited|national) (?:post|position|vacancy|consultancy|recruitment)\b/,
  /\bnational (?:post|position|recruitment)s? only\b/,
  /\b(?:open|restricted|limited|available) (?:only )?to (?:nationals|citizens) (?:of the country|of the host country)\b/,
  /\bonly (?:nationals|citizens) of the (?:host )?country\b/,
];

/**
 * Does the text say the post is only for nationals of this country (or nationals in general, as
 * ANY_COUNTRY)? `countryCode`: the listing's duty-station country, whose name and aliases are what
 * a country-specific statement must name ("nationals of Namibia only", "only Namibian nationals" is
 * matched by the country name's stem).
 */
export function saysNationalsOnly(text: string | null | undefined, countryCode: string | null | undefined): boolean {
  if (!text) return false;
  const t = fold(text);
  if (ANY_COUNTRY.some((re) => re.test(t))) return true;
  const c = countryByCode(countryCode);
  if (!c) return false;
  const names = [c.name, ...c.aliases].map(fold).filter((n) => n.length >= 4);
  // "Namibia" → "namibi" also finds "Namibian"; "Kenya" → "keny" finds "Kenyan".
  const stems = names.map((n) => esc(n.length > 5 ? n.slice(0, -1) : n));
  const country = `(?:the )?(?:${stems.join("|")})[a-z]*`;
  return [
    new RegExp(`\\b(?:nationals|citizens) of ${country} only\\b`),
    new RegExp(`\\bonly (?:to )?(?:qualified |eligible )?(?:${country} (?:nationals|citizens)|(?:nationals|citizens) of ${country})\\b`),
    new RegExp(`\\b(?:open|restricted|limited|available) (?:only )?to (?:qualified |eligible )?(?:${country} (?:nationals|citizens)|(?:nationals|citizens) of ${country})\\b`),
    new RegExp(`\\b(?:must|should) be (?:a )?(?:${country} (?:national|citizen)|(?:national|citizen) of ${country})\\b`),
  ].some((re) => re.test(t));
}
