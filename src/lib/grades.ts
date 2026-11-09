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

/**
 * Words in a TITLE that say the post is recruited locally, for listings whose grade wasn't parsed:
 * National (Professional) Officer, NPO, National (Individual) Consultant, National UN Volunteer,
 * "locally recruited", General Service grades written G-5 / GS-5 / GS5, NO-B, and IOM's "(G)"
 * suffix for General Service posts. Matched against the lower-cased title, as whole words.
 * One list for both rules below, so JavaScript and SQL agree.
 */
const LOCAL_TITLE_WORDS = [
  "national (professional )?officers?",
  "npos?",
  "national (individual )?consultants?",
  "national (un )?volunteers?",
  "locally[- ]recruited",
  "gs-?[1-7]",
  "g-[1-7]",
  "no-[a-e]",
];
/** IOM marks General Service vacancies with "(G)" at the end of the title ("(P)" is Professional). */
const LOCAL_TITLE_SUFFIX = "\\(g\\)\\s*$";

/** Postgres regex (advanced regex: \m and \M are word boundaries) for the lower-cased title. */
export const LOCAL_ONLY_TITLE_SQL = `\\m(${LOCAL_TITLE_WORDS.join("|")})\\M|${LOCAL_TITLE_SUFFIX}`;
const LOCAL_ONLY_TITLE_RE = new RegExp(`(?<![a-z0-9])(${LOCAL_TITLE_WORDS.join("|")})(?![a-z0-9])|${LOCAL_TITLE_SUFFIX}`);

/** Titles that name the National Officer category, from which the grade group NO is inferred. */
const NATIONAL_OFFICER_WORDS = "national (professional )?officers?|npos?";
export const NATIONAL_OFFICER_TITLE_SQL = `\\m(${NATIONAL_OFFICER_WORDS})\\M`;
const NATIONAL_OFFICER_TITLE_RE = new RegExp(`(?<![a-z0-9])(${NATIONAL_OFFICER_WORDS})(?![a-z0-9])`);

export function isLocalOnlyTitle(title: string | null | undefined): boolean {
  return Boolean(title && LOCAL_ONLY_TITLE_RE.test(title.toLowerCase()));
}

/**
 * Is the post usually open only to nationals or legal residents of the duty-station country?
 * From the parsed grade, or else from the title. Same rule as the "Hide local-only posts" filter
 * (the hidelocal condition in src/lib/jobs.ts).
 */
export function isLocalOnly(job: { grade: string | null | undefined; title: string | null | undefined }): boolean {
  return isLocalOnlyGrade(job.grade) || isLocalOnlyTitle(job.title);
}

/** Does the title name the National Officer category ("National Professional Officer", "NPO")? */
export function isNationalOfficerTitle(title: string | null | undefined): boolean {
  return Boolean(title && NATIONAL_OFFICER_TITLE_RE.test(title.toLowerCase()));
}

/**
 * The grade to show: the parsed one, or "National Officer" when no grade was parsed and the title
 * names the National Officer category. National Officer grades are written out ("NO-B" →
 * "National Officer B"), since "NO" on its own reads as the word. IOM's "(P)" and "(G)" suffixes
 * give a category, not a grade, so they only count for the local-only rule.
 */
export function displayGrade(job: { grade: string | null | undefined; title: string | null | undefined }): string | null {
  if (job.grade) {
    const no = job.grade.match(/^NO-?([A-E])$/i);
    return no ? `National Officer ${no[1].toUpperCase()}` : job.grade;
  }
  return isNationalOfficerTitle(job.title) ? "National Officer" : null;
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
