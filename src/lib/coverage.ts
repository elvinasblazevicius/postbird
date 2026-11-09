/**
 * "Covers vacancies from N organizations, including UNICEF, WHO, UNDP and IOM."
 * on /pricing and /pricing/trial: computed from the open listings (demo
 * listings left out), so the line is always true. Server only.
 */
import { cache } from "react";
import { organizationFacets } from "@/lib/jobs";

/** Below this many organizations with open vacancies the line isn't shown. */
export const COVERAGE_MIN_ORGS = 5;

export type Coverage = { count: number; names: string[] };

/**
 * Short names that are widely known and stand for one organization. Others are ambiguous ("DRC"
 * is also a country, "IRC" and "ADB" are more than one organization) or little known outside their
 * field, so the line uses the full name for those.
 */
const WELL_KNOWN_SHORT = new Set([
  "UNICEF", "UNDP", "WHO", "UNHCR", "WFP", "FAO", "ILO", "IOM", "UNFPA", "UN Women", "UNESCO", "UNEP", "UN-Habitat", "OCHA",
  "UNIDO", "UNRWA", "UNODC", "UNAIDS", "UNOPS", "ITU", "IAEA", "WIPO", "IFAD", "World Bank", "IMF", "EBRD", "OECD", "OSCE", "ICRC",
  "IFRC", "MSF", "NATO", "WTO",
]);

/** The name to show for an organization in a short list: a well-known short name, otherwise the full name. */
export function listName(name: string, short: string | null): string {
  return short && WELL_KNOWN_SHORT.has(short.trim()) ? short.trim() : name;
}

/**
 * Up to four names: the well-known short names (UNICEF, WHO…) of the organizations with the most
 * open vacancies; topped up with full names (not ambiguous acronyms such as "DRC") when fewer than
 * three are well known. Pure, so it is unit-tested.
 */
export function coverageFrom(orgs: { name: string; short_name: string | null; count: number }[]): Coverage | null {
  if (orgs.length < COVERAGE_MIN_ORGS) return null;
  const sorted = [...orgs].sort((a, b) => b.count - a.count);
  const names: string[] = [];
  const add = (n: string | null | undefined) => {
    const v = n?.trim();
    if (v && !names.includes(v) && names.length < 4) names.push(v);
  };
  for (const o of sorted) if (o.short_name && WELL_KNOWN_SHORT.has(o.short_name.trim())) add(o.short_name);
  // Full names are longer: top up to three, skipping very long ones so the line stays short.
  if (names.length < 3) for (const o of sorted) if (names.length < 3 && o.name.length <= 40 && !(o.short_name && names.includes(o.short_name.trim()))) add(o.name);
  return { count: orgs.length, names };
}

/** "UNICEF, WHO, UNDP and IOM". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "One email with the new vacancies we find from IOM, WHO, UNESCO and 117 other organizations, so
 * you check fewer career sites." from the coverage (three names, then the number of the others); a
 * plain line without numbers when the coverage isn't shown (fewer than COVERAGE_MIN_ORGS
 * organizations). It never says every vacancy: our sources may not carry all of an employer's posts.
 */
export function oneEmailLine(c: Coverage | null): string {
  const tail = "so you check fewer career sites.";
  if (!c || !c.names.length) return `One email with the new vacancies we find, ${tail}`;
  const names = c.names.slice(0, 3);
  const others = c.count - names.length;
  if (others < 1) return `One email with the new vacancies we find from ${joinNames(names)}, ${tail}`;
  return `One email with the new vacancies we find from ${names.join(", ")} and ${others.toLocaleString("en-US")} other ${others === 1 ? "organization" : "organizations"}, ${tail}`;
}

/** What the site doesn't promise (the pricing FAQ and /about): our sources may not carry every vacancy of an employer. */
export const COVERAGE_CAVEAT = "We list the vacancies our sources publish, which may not be all of an organization's vacancies. For a specific employer, also check its own careers site.";

/** Shared by everything in one render (the pricing page asks twice). */
export const coverage = cache(async (): Promise<Coverage | null> => {
  const orgs = await organizationFacets(1000, false).catch(() => []);
  return coverageFrom(orgs);
});
