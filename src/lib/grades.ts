/**
 * Grade helpers shared by the filters, the job page and the alerts.
 * Grades are stored normalized by the importer ("P-3", "NO-B", "G-5", "NPSA-8").
 */
import { GRADE_GROUPS } from "@/config/regions";

/**
 * Grades that are usually open only to nationals or legal residents of the
 * duty-station country: National Officers (NO-A to NO-E), General Service
 * (G / GS), NPSA, LICA and service contracts (SB / SC). IPSA, ICS and Field
 * Service are international contracts and are not included.
 */
export const LOCAL_ONLY_GRADE_SQL = "^(NO-[A-E]|GS?-[0-9]{1,2}|NPSA-[0-9]{1,2}|LICA-[0-9]{1,2}|SB-[0-9]{1,2}|SC-[0-9]{1,2})$";

const LOCAL_ONLY_RE = /^(NO-?[A-E]|GS?-?\d{1,2}|NPSA-?\d{1,2}|LICA-?\d{1,2}|SB-?\d{1,2}|SC-?\d{1,2})$/i;

export function isLocalOnlyGrade(grade: string | null | undefined): boolean {
  return Boolean(grade && LOCAL_ONLY_RE.test(grade.trim().replace(/\s+/g, "")));
}

/** The grade groups shown in the filter (the overlapping "entry" group is kept only for old links). */
export const FILTER_GRADE_GROUPS = GRADE_GROUPS.filter((g) => g.value !== "entry");

const SERVICE_CONTRACT_RE = /^(SB|SC|LICA|NPSA|IPSA|ICS)-/;

/** Which filter group an exact grade belongs to ("P-3" → "P"), or null for grades outside every group. */
export function gradeGroupOf(grade: string): string | null {
  if (SERVICE_CONTRACT_RE.test(grade)) return "SC";
  return FILTER_GRADE_GROUPS.find((g) => g.grades.includes(grade))?.value ?? null;
}

/** Does a stored grade fall under a filter value (a group such as "P", or an exact grade such as "P-3")? */
export function gradeMatches(filter: string, grade: string): boolean {
  const group = GRADE_GROUPS.find((g) => g.value === filter);
  if (!group) return filter === grade;
  if (group.value === "SC") return SERVICE_CONTRACT_RE.test(grade);
  return group.grades.includes(grade);
}

export function isGradeGroup(value: string | undefined): boolean {
  return Boolean(value && GRADE_GROUPS.some((g) => g.value === value));
}

/** Short label for a grade filter value: "Professional (P-1 to P-5)" or "P-3". */
export function gradeLabel(value: string): string {
  return GRADE_GROUPS.find((g) => g.value === value)?.name ?? value;
}
