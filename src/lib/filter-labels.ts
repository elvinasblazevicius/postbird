/**
 * Plain-language names for the filters that can hold several values (places and grades),
 * shared by page titles, filter chips and saved-search labels.
 */
import { countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, regionBySlug } from "@/config/regions";
import { gradeText } from "@/lib/grades";

/** "Kenya", "Kenya or Uganda", "Kenya, Uganda or Africa". */
export function orList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** "a grade", "a grade and a contract type", "a grade, a contract type and language requirements". */
export function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What each filter read from a posting's text needs the posting to state (DERIVED_FILTERS in src/lib/jobs.ts). */
export const STATED_DETAIL: Record<"grade" | "exp" | "lang" | "type", string> = {
  grade: "a grade",
  exp: "the experience required",
  lang: "language requirements",
  type: "a contract type",
};

/** Names of the chosen regions and countries, regions first. */
export function placeNames(f: { country?: string[]; region?: string[] }): string[] {
  return [
    ...(f.region ?? []).map((s) => regionBySlug(s)?.name ?? s),
    ...(f.country ?? []).map((s) => countryBySlug(s)?.name ?? s),
  ];
}

/** A grade filter value without the group's grade range: "Professional", "P-3". */
export function gradeShortName(value: string): string {
  return GRADE_GROUPS.find((g) => g.value === value)?.name.replace(/ \(.*\)$/, "") ?? gradeText(value);
}

type SortKey = "newest" | "deadline" | "relevance";

/**
 * The line above a page of results, the same on /jobs and on every landing page: "340 vacancies
 * found · showing 21–40" (the total only where it is shown: `showTotal`, otherwise "Showing 21–40"),
 * "5 vacancies found" when they all fit on one page, "1 vacancy found", "No vacancies found".
 */
export function resultsHeading(r: { total: number; from: number; to: number; pages: number; sort: SortKey; showTotal: boolean }): string {
  // The number found comes first, in plain words; the order is shown by the sort buttons beside it.
  if (r.total === 0) return "No vacancies found";
  if (r.total === 1) return "1 vacancy found";
  if (r.pages <= 1) return `${r.total.toLocaleString("en-US")} vacancies found`;
  const range = `${r.from.toLocaleString("en-US")}–${r.to.toLocaleString("en-US")}`;
  return r.showTotal ? `${r.total.toLocaleString("en-US")} vacancies found · showing ${range}` : `Showing ${range}`;
}
