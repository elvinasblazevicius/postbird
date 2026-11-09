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

const SORT_HEADINGS = { newest: "Newest first", deadline: "Closing soonest first", relevance: "Best match first" } as const;

/**
 * The line above a page of results, the same on /jobs and on every landing page: "Newest first ·
 * 21–40 of 340" (the total only where it is shown: `showTotal`), "Newest first · 5 open vacancies"
 * when they all fit on one page, "1 open vacancy", "No open vacancies match".
 */
export function resultsHeading(r: { total: number; from: number; to: number; pages: number; sort: keyof typeof SORT_HEADINGS; showTotal: boolean }): string {
  if (r.total === 0) return "No open vacancies match";
  if (r.total === 1) return "1 open vacancy";
  const order = SORT_HEADINGS[r.sort];
  if (r.pages <= 1) return `${order} · ${r.total.toLocaleString("en-US")} open vacancies`;
  return `${order} · ${r.from.toLocaleString("en-US")}–${r.to.toLocaleString("en-US")}${r.showTotal ? ` of ${r.total.toLocaleString("en-US")}` : ""}`;
}
