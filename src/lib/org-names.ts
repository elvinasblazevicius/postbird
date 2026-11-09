/**
 * How an organization is named in running text: "WFP", "the World Bank",
 * "the International Rescue Committee", "Save the Children".
 */

/** Words that make an organization's full name read as "the …" ("the World Bank", "the Norwegian Refugee Council"). */
const NEEDS_THE = /\b(bank|programme|program|organi[sz]ation|fund|office|commission|agency|institute|committee|council|federation|court|union|centre|center|secretariat|authority|board|facility|alliance|partnership|foundation|network|service|parliament|ombudsman)\b/i;

/** The full name with "the" in front where English needs it. */
export function withArticle(name: string): string {
  const n = name.trim();
  if (/^the\s/i.test(n)) return n.replace(/^The\s/, "the ");
  return NEEDS_THE.test(n) && !/^[A-Z0-9-]{2,}\b/.test(n) ? `the ${n}` : n;
}

/** An acronym-style short name ("WFP", "UNICEF", "UN-Habitat", "UN Women"), usable on its own without "the". */
export function isAcronym(short: string | null | undefined): short is string {
  return Boolean(short && short.length <= 12 && /^[A-Z][A-Z0-9]+(?:[- ][A-Z]?[A-Za-z]+)?$/.test(short) && /^[A-Z]{2,}/.test(short));
}

/** The name to use in a sentence: the acronym when there is one, otherwise the full name with "the" where needed. */
export function orgInText(name: string | null | undefined, short: string | null | undefined): string | null {
  if (isAcronym(short)) return short;
  return name ? withArticle(name) : null;
}

/** "Postbird is independent and not affiliated with WFP." One sentence, for the organization and employer-type landing pages. */
export function nonAffiliationLine(siteName: string, org: string | null): string {
  return `${siteName} is independent and not affiliated with ${org ?? "these organizations"}.`;
}
