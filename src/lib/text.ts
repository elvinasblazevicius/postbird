import sanitizeHtml from "sanitize-html";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", aacute: "á", acirc: "â", ccedil: "ç",
  ocirc: "ô", oacute: "ó", iacute: "í", uacute: "ú", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
  Eacute: "É", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? m;
  });
}

/** Collapse runs of spaces/tabs but keep line breaks. */
function tidyLines(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}

/** Convert HTML to plain text, keeping one line per block element. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|tr|table|section|article|h[1-6]|dt|dd|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " \t ");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return tidyLines(decodeEntities(decodeEntities(stripped)).replace(/ \t /g, " "));
}

/** Single-line plain text (for titles and labels). */
export function oneLine(s: string | null | undefined): string {
  if (!s) return "";
  return decodeEntities(String(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Safe subset of HTML for full descriptions (only used when a feed allows full text). */
export function sanitizeDescription(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "h2", "h3", "h4", "a", "blockquote",
      "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      h1: "h2",
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, rel: "nofollow noopener noreferrer", target: "_blank" },
      }),
    },
    exclusiveFilter: (frame) => ["p", "li", "strong", "b", "em", "i"].includes(frame.tag) && !frame.text.trim(),
  });
  return clean.trim();
}

/**
 * sanitizeDescription, at most `max` characters, and always well-formed: a
 * longer result is cut (never inside a tag or an entity) and sanitized again,
 * which closes the tags the cut left open. Closing tags add a few
 * characters, so the cut shrinks until the result fits.
 */
export function sanitizeDescriptionMax(html: string, max: number): string {
  let clean = sanitizeDescription(html);
  for (let limit = max; clean.length > max && limit > 0; limit = Math.floor(limit * 0.98)) {
    const cut = clean.slice(0, limit).replace(/<[^>]*$/, "").replace(/&[#\w]*$/, "");
    clean = sanitizeDescription(cut);
  }
  return clean;
}

/** First ~n characters of plain text, cut at a word boundary. */
export function excerpt(text: string, n: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= n) return flat;
  const cut = flat.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > n * 0.6 ? lastSpace : n).replace(/[\s,;:.–-]+$/, "") + "…";
}

export function slugify(s: string, max = 80): string {
  const slug = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= max) return slug || "job";
  return slug.slice(0, max).replace(/-[^-]*$/, "") || "job";
}

/** Lower-case, accent-free, punctuation-free text for comparisons. */
export function normalizeForCompare(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
