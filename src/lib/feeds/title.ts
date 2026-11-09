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
  return t.replace(/\s{2,}/g, " ").trim();
}
