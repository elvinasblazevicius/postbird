/**
 * Tidying vacancy titles as published: leading requisition numbers,
 * ALL-CAPS titles and bilingual "English || Arabic" titles.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "de", "du", "des", "la", "le", "et", "y", "en"]);

function titleCaseWord(w: string, first: boolean): string {
  const lower = w.toLowerCase();
  if (!first && SMALL.has(lower)) return lower;
  // Short words in an all-caps title are usually acronyms (HQ, ICT, M&E, WASH stays as typed below).
  if (/^[A-Z&]{2,3}$/.test(w)) return w;
  return lower.replace(/(^|[-/(])([a-zà-ÿ])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

export function cleanTitle(raw: string): string {
  let t = raw.trim();
  // "Field Documentation Officer || موثق/ـة ميداني/ـة": keep the Latin-script part.
  if (t.includes("||")) {
    const parts = t.split("||").map((p) => p.trim()).filter(Boolean);
    t = parts.find((p) => /[a-z]/i.test(p)) ?? parts[0] ?? t;
  }
  // "23559 Monitoring and Evaluation Officer", "REQ-12345 - Analyst", "#1234: Officer"
  t = t.replace(/^(?:#|req(?:uisition)?[-\s#]*|vacancy\s+(?:no\.?\s*)?)?(?!(?:19|20)\d\d\b)\d{4,8}\s*[-–—:]?\s+(?=\p{L})/iu, "");
  // ALL CAPS → Title Case (only when the title is mostly capitals).
  const letters = t.replace(/[^\p{L}]/gu, "");
  const upper = t.replace(/[^\p{Lu}]/gu, "");
  if (letters.length >= 8 && upper.length / letters.length > 0.85) {
    t = t.split(/(\s+)/).map((w, i) => (/\s/.test(w) ? w : titleCaseWord(w, i === 0))).join("");
  }
  // A hyphen with a space on one or both sides separates parts of the title: "Officer- TVET",
  // "Officer -TVET" and "Officer - TVET" all become "Officer – TVET" (en dash). Hyphens inside
  // words ("Non-Food") and suspended hyphens before "and/or/to" ("pre- and post-") are left alone.
  t = t.replace(/(?<=\S)(?:\s+-\s*|-\s+)(?!(?:and|or|to)\s)(?=\S)/gi, " – ");
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * The title as used for the job's URL slug: without a source's reference number at the start, which
 * cleanTitle keeps when it isn't a plain requisition number ("VA-2026-045: Finance Officer",
 * "(JO 12345) Finance Officer", "No. 123 – Finance Officer"), and without the vacancy's own
 * reference when the title starts with it. Only the slug changes; the title shown is cleanTitle's.
 */
export function titleForSlug(title: string, reference?: string | null): string {
  let t = title.trim();
  if (reference) {
    const ref = reference.trim();
    if (ref && t.toLowerCase().startsWith(ref.toLowerCase())) t = t.slice(ref.length);
  }
  // A bracketed reference: "(12345)", "[VA 2026/45]".
  t = t.replace(/^\s*[([][^)\]]*\d[^)\]]*[)\]]\s*[-–—:|]?\s*/u, "");
  // A reference-like first token (letters, digits and -/._#) with at least one digit, followed by a separator:
  // "VA-2026-045:", "JO 12345 –", "No. 123 -", "#456 |": at least 3 digits, so "COVID-19 – …" stays.
  // Not a year on its own ("2026 Graduate Programme").
  t = t.replace(/^\s*(?:(?:ref(?:erence)?|no|nr|vacancy|va|jo|job(?:\s+opening)?|req(?:uisition)?)\.?\s*(?:no\.?|number|id)?\s*[:#]?\s*)?(?!(?:19|20)\d\d\s)(?=[a-z]{0,6}[-/._#]?(?:[\w\-/.#]*?\d){3})[a-z]{0,6}[-/._#]?\d[\w\-/.#]*\s*[-–—:|]\s*(?=\p{L})/iu, "");
  return t.trim() || title.trim();
}
