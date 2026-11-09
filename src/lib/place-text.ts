/** Location text helpers for the job page. */

const placeParts = (s: string) => s.toLowerCase().split(/[,;/|()]+|\s+-\s+/).map((x) => x.trim()).filter(Boolean);

/**
 * The location as published, when it says more than the place we show: "Amman" next to
 * "Amman, Jordan" adds nothing, "Amman and Irbid" does.
 */
export function extraLocation(where: string, text: string | null): string | null {
  if (!text || text === where) return null;
  const shown = placeParts(where);
  return placeParts(text).every((p) => shown.includes(p)) ? null : text;
}
