/** Location text helpers for the job page. */

const SEPARATOR = /[,;/|()]+|\s+[-–—]\s+/;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const placeParts = (s: string) => s.split(SEPARATOR).map(fold).filter(Boolean);
/** Words that start a note about the location rather than another place ("Home-based possible", "Multiple locations"). */
const NOT_A_PLACE = /^(?:with|including|plus|home|remote|travel|frequent|occasional|field|flexible|possible|multiple|various|several|any|region|regional|global|worldwide|based|tbd|to be)\b/i;

/**
 * The part of the location as published that the place we show doesn't already say, or null:
 * "Amman" or "Amman, Jordan" next to "Amman, Jordan" add nothing; "Amman, Jordan with frequent
 * travel to the region" adds "with frequent travel to the region"; "Juba; Wau" next to "Juba,
 * South Sudan" adds "also Wau", "Amman and Irbid" next to "Amman, Jordan" adds "also Irbid", and
 * "Nairobi or Mombasa, Kenya" next to "Kenya" adds "Nairobi or Mombasa".
 */
export function extraLocation(where: string, text: string | null): string | null {
  if (!text || text === where) return null;
  const shown = placeParts(where);
  if (!shown.length) return null;
  const extra: string[] = [];
  let joined = false; // the extra part was joined to a place we show with "and" ("Amman and Irbid")
  for (const raw of text.split(SEPARATOR)) {
    const segment = raw.trim().replace(/\s+/g, " ");
    if (!segment || shown.includes(fold(segment))) continue;
    // "Amman and Irbid", "Jordan with frequent travel": take off a place we show at the start.
    const lead = shown.find((p) => fold(segment).startsWith(`${p} `));
    let rest = lead ? segment.split(" ").slice(lead.split(" ").length).join(" ") : segment;
    if (lead && /^(?:and|&)\s/i.test(rest)) {
      rest = rest.replace(/^(?:and|&)\s+/i, "");
      joined = true;
    }
    if (rest) extra.push(rest);
  }
  if (!extra.length) return null;
  const out = extra.join(", ");
  // Other places next to a city we show get "also" ("also Wau"); next to a country alone they are
  // places in it ("Kenya (Nairobi or Mombasa)"); a note such as "with frequent travel …" stays as it is.
  const anotherPlace = joined || (shown.length > 1 && /^\p{Lu}/u.test(out));
  return anotherPlace && !NOT_A_PLACE.test(out) ? `also ${out}` : out;
}
