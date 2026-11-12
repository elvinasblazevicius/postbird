/**
 * Finding the countries a listing's location text names, e.g.
 * "Nairobi, Kenya; Kampala, Uganda". The same rules run in JavaScript (for
 * the filter counts) and in SQL (for the filter itself), so a count and the
 * results behind it agree:
 *  - text is lower-cased, common accents are folded, apostrophes dropped and
 *    everything other than letters and digits becomes a single space;
 *  - a country is named when one of its names or aliases appears as whole words;
 *  - a longer name wins over a shorter one inside it ("South Sudan" is not
 *    "Sudan", "Papua New Guinea" is not "Guinea"), and a few place names that
 *    contain a country name are never read as that country ("New Jersey").
 */
import { COUNTRIES } from "@/config/countries";

/** Accented letters folded to plain ones; the same pairs are used by SQL translate(). */
export const FOLD_FROM = "àáâãäåāăąçćčďèéêëēěęìíîïīıñńňòóôõöøōőŕřśšşťùúûüūůűýÿźżžğ";
export const FOLD_TO = "aaaaaaaaaccc" + "d" + "eeeeeee" + "iiiiii" + "nnn" + "oooooooo" + "rr" + "sss" + "t" + "uuuuuuu" + "yy" + "zzz" + "g";
/** Characters removed outright (apostrophes), so "d'Ivoire" reads "divoire". */
export const DROP_CHARS = "'’`";

const FOLD = new Map([...FOLD_FROM].map((c, i) => [c, FOLD_TO[i]]));

/** The normalized form both sides compare: " cote divoire " (with a space at each end). */
export function normalizePlace(text: string | null | undefined): string {
  let s = "";
  for (const ch of String(text ?? "").toLowerCase()) {
    if (DROP_CHARS.includes(ch)) continue;
    s += FOLD.get(ch) ?? ch;
  }
  return ` ${s.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Place names that contain a country name but are somewhere else. */
const NOT_COUNTRIES = ["new jersey", "new south wales", "new mexico"];

type Name = { key: string; code: string };

/** Every country name and alias, normalized, longest first. */
/**
 * Names some sources write the other way round. Without them "Sudan, Republic of South" would be
 * read as Sudan and "Congo, The Dem. Rep. Of" as the Republic of the Congo.
 */
const INVERTED_NAMES: [string, string][] = [
  ["Sudan, Republic of South", "SS"], ["Sudan, South", "SS"],
  ["Congo, The Dem. Rep. Of", "CD"], ["Congo, Dem. Rep. Of", "CD"], ["Congo, Dem. Rep.", "CD"], ["Congo, The Democratic Republic of the", "CD"], ["Congo, Democratic Republic", "CD"],
  ["Korea, Dem. People's Rep. Of", "KP"], ["Korea, Democratic People's Republic of", "KP"], ["Korea, North", "KP"],
  ["Korea, South", "KR"],
  ["Guinea, Equatorial", "GQ"], ["Macedonia, North", "MK"],
];

const NAMES: Name[] = [
  ...COUNTRIES.flatMap((c) => [c.name, ...c.aliases].map((n) => ({ key: normalizePlace(n).trim(), code: c.code }))),
  ...INVERTED_NAMES.map(([n, code]) => ({ key: normalizePlace(n).trim(), code })),
]
  .filter((n) => n.key.length >= 2)
  .filter((n, i, all) => all.findIndex((m) => m.key === n.key && m.code === n.code) === i)
  .sort((a, b) => b.key.length - a.key.length);

const contains = (outer: string, inner: string) => outer !== inner && ` ${outer} `.includes(` ${inner} `);

const cache = new Map<string, string[]>();

/** Country codes named in a location text, in the order of the name list (longest names first). */
export function countriesInLocation(text: string | null | undefined): string[] {
  if (!text) return [];
  const hit = cache.get(text);
  if (hit) return hit;
  let s = normalizePlace(text);
  for (const n of NOT_COUNTRIES) s = s.replaceAll(` ${n} `, "  ");
  const found: string[] = [];
  for (const n of NAMES) {
    const needle = ` ${n.key} `;
    if (!s.includes(needle)) continue;
    if (!found.includes(n.code)) found.push(n.code);
    // Blank the match so a shorter name inside it ("sudan" in "south sudan") is not read again.
    s = s.replaceAll(needle, " ".repeat(needle.length - 1) + " ");
  }
  if (cache.size > 20_000) cache.clear();
  cache.set(text, found);
  return found;
}

/**
 * Regular expressions (Postgres ARE syntax, but plain enough for JavaScript)
 * used on the normalized text to match a set of countries:
 * `strip` removes longer names of OTHER countries that contain one of these
 * names (and the never-a-country place names), then `match` looks for the names.
 */
export function locationPatterns(codes: string[]): { strip: string; match: string } | null {
  const set = new Set(codes.map((c) => c.toUpperCase()));
  const target = NAMES.filter((n) => set.has(n.code)).map((n) => n.key);
  if (!target.length) return null;
  const others = NAMES.filter((n) => !set.has(n.code) && target.some((t) => contains(n.key, t))).map((n) => n.key);
  const strip = [...new Set([...others, ...NOT_COUNTRIES])].sort((a, b) => b.length - a.length);
  // Keys contain only a-z, 0-9 and single spaces, so they need no escaping.
  return { strip: ` (${strip.join("|")})(?= )`, match: ` (${target.join("|")})(?= )` };
}
