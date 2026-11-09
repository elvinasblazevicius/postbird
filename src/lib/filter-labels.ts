/**
 * Plain-language names for the filters that can hold several values (places and grades),
 * shared by page titles, filter chips and saved-search labels.
 */
import { countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, regionBySlug } from "@/config/regions";

/** "Kenya", "Kenya or Uganda", "Kenya, Uganda or Africa". */
export function orList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Names of the chosen regions and countries, regions first. */
export function placeNames(f: { country?: string[]; region?: string[] }): string[] {
  return [
    ...(f.region ?? []).map((s) => regionBySlug(s)?.name ?? s),
    ...(f.country ?? []).map((s) => countryBySlug(s)?.name ?? s),
  ];
}

/** A grade filter value without the group's grade range: "Professional", "P-3". */
export function gradeShortName(value: string): string {
  return GRADE_GROUPS.find((g) => g.value === value)?.name.replace(/ \(.*\)$/, "") ?? value;
}
