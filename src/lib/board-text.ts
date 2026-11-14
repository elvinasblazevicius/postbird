/**
 * Job boards that re-post vacancies add their own text to the description: a "This position is no
 * longer open / Before you apply / report this job" footer, "At Impactpool we do our best…"
 * notices, contract-type explainers, links back to their own pages, and email addresses hidden
 * behind their CDN ("[email protected]"). The site shows only the employer's own text and never
 * links to or names those boards, so this removes all of it. Run at import (src/lib/feeds/extract.ts)
 * and again when a vacancy page is shown, for listings imported before a rule existed.
 */

const BOARD_HOST = /(?:^|\.)(?:reliefweb\.int|unjobs\.org|impactpool\.org|devex\.com|unjobnet\.org|idealist\.org|unvacancies\.org|untalent\.org|eurobrussels\.com)$/i;

/** Whole paragraphs that are the board's own words. */
const BOARD_PARAGRAPHS: RegExp[] = [
  /^this position is no longer open\.?$/i,
  /^before you apply$/i,
  /we review listings for quality/i,
  /report this job/i,
  /^at impactpool we do our best/i,
  /^before applying, please make sure that you have read the requirements for the position and that you qualify/i,
  /^this is an? .{1,60} contract\. more about .{1,60} contracts\.?$/i,
  /^application deadline: .{1,60}\(\d+ days?\)$/i,
  /^show advice for this position$/i,
];

const hostOf = (href: string) => {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

/** The email address placeholder a board's CDN leaves when it hides an address. */
const HIDDEN_EMAIL = /\[email(?:&#160;|&nbsp;|\s)protected\]/i;

export function stripBoardText(html: string): string {
  let out = html;
  // Board paragraphs.
  out = out.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (m, inner: string) => (BOARD_PARAGRAPHS.some((re) => re.test(textOf(inner))) ? "" : m));
  // Links to the board: an email hidden by its CDN becomes a plain note; any other link keeps its words, without the link.
  out = out.replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href: string, inner: string) => {
    if (!BOARD_HOST.test(hostOf(href))) return m;
    if (/cdn-cgi\/l\/email-protection/i.test(href) || HIDDEN_EMAIL.test(inner)) return "(email address on the employer’s posting)";
    const words = textOf(inner);
    return /^(show advice for this position|more about .* contracts?)$/i.test(words) ? "" : inner;
  });
  out = out.replace(/[\w.+-]*\[email(?:&#160;|&nbsp;|\s)protected\]/gi, "(email address on the employer’s posting)");
  // Impactpool's header line before the employer's text ("IOM - International Organization for MigrationChadNationalGS-4, …Speaks French").
  out = out.replace(/^\s*(?:<a\b[^>]*>\s*<\/a>\s*)?[^<]{0,300}?Speaks [A-Z][a-z]+(?:, [A-Z][a-z]+)*\s*(?=<p)/, "");
  // Empty links and paragraphs left behind.
  out = out.replace(/<a\b[^>]*>\s*<\/a>/gi, "").replace(/<p\b[^>]*>\s*<\/p>/gi, "");
  return out.trim();
}
