/**
 * Date helpers. Deadlines are only taken from text that is clearly
 * labelled as a closing date, and only when the date is unambiguous.
 */

const MONTHS: Record<string, number> = {
  // English
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  // French
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, août: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
  // Spanish
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Find the first unambiguous calendar date in a short piece of text.
 * Returns YYYY-MM-DD or null.
 */
export function findDate(text: string): string | null {
  const s = text.normalize("NFC").toLowerCase();
  let m: RegExpMatchArray | null;

  // 2026-11-15 or 2026/11/15
  if ((m = s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) return iso(+m[1], +m[2], +m[3]);

  // 15 November 2026, 15-Nov-2026, 15 nov. 2026, 15th of November, 2026, 1er novembre 2026, 15 de noviembre de 2026
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|er)?(?:\\s+of|\\s+de)?[\\s\\-./]+(${MONTH_RE})\\.?(?:\\s+de)?[\\s\\-.,/]+(20\\d{2})\\b`);
  if ((m = s.match(dmy))) return iso(+m[3], MONTHS[m[2]], +m[1]);

  // November 15, 2026 / Nov 15 2026
  const mdy = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`);
  if ((m = s.match(mdy))) return iso(+m[3], MONTHS[m[1]], +m[2]);

  // 15.11.2026 (dot-separated dates are day-first in practice)
  if ((m = s.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/))) return iso(+m[3], +m[2], +m[1]);

  // 15/11/2026 or 11/15/2026: only when one side is clearly a day (>12)
  if ((m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/))) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return iso(y, b, a);
    if (b > 12 && a <= 12) return iso(y, a, b);
    if (a === b) return iso(y, a, b);
    return null; // ambiguous (e.g. 05/06/2026) — never guess
  }
  return null;
}

const DEADLINE_LABEL =
  /(closing\s+date|application\s+deadline|deadline\s+for\s+(?:applications?|submission)|deadline|apply\s+by|applications?\s+close[sd]?(?:\s+on)?|closes\s+on|closing\s+on|vacancy\s+end\s+date|posting\s+end\s+date|date\s+limite(?:\s+de\s+candidature)?|fecha\s+l[ií]mite|fecha\s+de\s+cierre)/gi;

/** Extract a deadline from text where it is explicitly labelled. */
export function extractDeadline(text: string): string | null {
  if (!text) return null;
  DEADLINE_LABEL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEADLINE_LABEL.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    // the date must follow the label closely (allow ":", "(GMT)", "is", "-" etc.)
    const window = after.replace(/^\s*(?:\([^)]{0,40}\))?\s*(?:[:：\-–—]|is|on)?\s*/i, "");
    const d = findDate(window.slice(0, 50));
    if (d) return d;
  }
  return null;
}

/** Parse a feed timestamp (RFC 822 / ISO 8601). Returns a Date or null. */
export function parseFeedDate(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  const d = findDate(s);
  return d ? new Date(`${d}T00:00:00Z`) : null;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
