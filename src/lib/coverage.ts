/**
 * "Covers vacancies from N organizations, including UNICEF, WHO, UNDP and IOM."
 * on /pricing and /pricing/trial: computed from the open listings (demo
 * listings left out), so the line is always true. Server only.
 */
import { organizationFacets } from "@/lib/jobs";

/** Below this many organizations with open vacancies the line isn't shown. */
export const COVERAGE_MIN_ORGS = 5;

export type Coverage = { count: number; names: string[] };

/**
 * Up to four well-known names: the short names (UNICEF, WHO…) of the
 * organizations with the most open vacancies; topped up with full names when
 * fewer than three have a short name. Pure, so it is unit-tested.
 */
export function coverageFrom(orgs: { name: string; short_name: string | null; count: number }[]): Coverage | null {
  if (orgs.length < COVERAGE_MIN_ORGS) return null;
  const sorted = [...orgs].sort((a, b) => b.count - a.count);
  const names: string[] = [];
  const add = (n: string | null | undefined) => {
    const v = n?.trim();
    if (v && !names.includes(v) && names.length < 4) names.push(v);
  };
  for (const o of sorted) if (o.short_name && o.short_name.length <= 12) add(o.short_name);
  if (names.length < 3) for (const o of sorted) if (names.length < 3) add(o.name);
  return { count: orgs.length, names };
}

/** "UNICEF, WHO, UNDP and IOM". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function coverage(): Promise<Coverage | null> {
  const orgs = await organizationFacets(1000, false).catch(() => []);
  return coverageFrom(orgs);
}
