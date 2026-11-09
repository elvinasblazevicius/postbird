/**
 * The short factual block on an organization's page: what its listings usually are, worked out
 * from the listings themselves (organizationPostingMix in src/lib/jobs.ts), nothing assumed.
 */
import { andList } from "@/lib/filter-labels";
import { gradeGroupOf } from "@/lib/grades";

type Count = { k: string; n: number };

/** Fewer listings than this stating a detail say nothing about what is usual. */
export const USUAL_MIN_LISTINGS = 3;
/** A contract type or grade group counts as usual from this share of the listings that state one. */
export const USUAL_MIN_SHARE = 0.25;

/** Names of the grade groups as they read in "Professional and General Service grades". */
const GROUP_NAMES: Record<string, string> = {
  P: "Professional",
  D: "Director",
  NO: "National Officer",
  G: "General Service",
  FS: "Field Service",
  AD: "EU AD",
  AST: "EU AST",
  "AST-SC": "EU AST/SC",
  FG: "EU contract agent",
  WBG: "World Bank Group",
};

/** The usual values: at least USUAL_MIN_SHARE of those stating one, most first, at most three. */
function usual(rows: Count[]): string[] {
  const total = rows.reduce((n, r) => n + r.n, 0);
  if (total < USUAL_MIN_LISTINGS) return [];
  return [...rows].sort((a, b) => b.n - a.n || a.k.localeCompare(b.k)).filter((r) => r.n / total >= USUAL_MIN_SHARE).slice(0, 3).map((r) => r.k);
}

/**
 * "fixed-term and consultancy contracts; Professional and General Service grades" from an
 * organization's contract types and grades (single grades are counted under their group), or
 * null when there aren't enough listings that state them.
 */
export function usuallyPosts(mix: { types: Count[]; grades: Count[] }): string | null {
  const types = usual(mix.types).map((t) => t.toLowerCase());
  const groups = new Map<string, number>();
  for (const g of mix.grades) {
    const group = gradeGroupOf(g.k) ?? "other";
    groups.set(group, (groups.get(group) ?? 0) + g.n);
  }
  const grades = usual([...groups].map(([k, n]) => ({ k, n })));
  const named = grades.filter((g) => GROUP_NAMES[g]).map((g) => GROUP_NAMES[g]);
  const gradePart = [
    named.length ? `${andList(named)} grades` : null,
    grades.includes("SC") ? "service contracts" : null,
  ].filter(Boolean) as string[];
  const parts = [types.length ? `${andList(types)} contracts` : null, gradePart.length ? andList(gradePart) : null].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

/** "IT", "WASH" stay as they are; other category names start lower-case inside a sentence. */
const inSentence = (name: string) => (/^[A-Z]{2,5}\b/.test(name) ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`);

/** "health, IT and logistics"; with a comma before the last "and" when a name has its own ("finance, and procurement and logistics"). */
const fieldList = (names: string[]) =>
  names.length > 2 && names.some((n) => / and /.test(n)) ? `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}` : andList(names);

/**
 * The page-specific intro line of an employer-type page, from its open listings: "The largest
 * fields right now are programme management, health and logistics. Usually fixed-term contracts;
 * Professional grades." Null with fewer than USUAL_MIN_LISTINGS listings. Pure, so it is unit-tested.
 */
export function postingProfile(f: {
  categories: { slug: string; name: string; count: number }[];
  types: { job_type: string; count: number }[];
  grades: { grade: string; count: number }[];
}): string | null {
  const total = f.categories.reduce((n, c) => n + c.count, 0);
  if (total < USUAL_MIN_LISTINGS) return null;
  const top = f.categories
    .filter((c) => c.slug !== "other" && c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((c) => inSentence(c.name));
  const usually = usuallyPosts({ types: f.types.map((t) => ({ k: t.job_type, n: t.count })), grades: f.grades.map((g) => ({ k: g.grade, n: g.count })) });
  const parts = [
    top.length > 1 ? `The largest fields right now are ${fieldList(top)}.` : top.length ? `The largest field right now is ${top[0]}.` : null,
    usually ? `Usually ${usually}.` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
