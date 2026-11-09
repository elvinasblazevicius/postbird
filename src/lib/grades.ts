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
/**
 * IOM marks General Service vacancies with "(G)" at the end of the title and Professional ones with
 * "(P)" (sometimes followed by " - Place"). Postgres and JavaScript regexes for the lower-cased title.
 */
const IOM_SUFFIX = (letter: "g" | "p") => `\\(${letter}\\)(\\s*$|\\s+[-–—|,])`;
const LOCAL_TITLE_SUFFIX = IOM_SUFFIX("g");
export const GENERAL_SERVICE_TITLE_SQL = IOM_SUFFIX("g");
export const PROFESSIONAL_TITLE_SQL = IOM_SUFFIX("p");
const GENERAL_SERVICE_TITLE_RE = new RegExp(GENERAL_SERVICE_TITLE_SQL);
const PROFESSIONAL_TITLE_RE = new RegExp(PROFESSIONAL_TITLE_SQL);

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
 * The grade group a title names when no grade was parsed: "NO" for "National (Professional)
 * Officer" / "NPO", "P" for IOM's "(P)" suffix, "G" for its "(G)" suffix. The filters, the grade
 * counts and the job pages all use this (with the same SQL in src/lib/jobs.ts), so such a listing
 * counts once, under "{Group}, any level".
 */
export function titleGradeGroup(title: string | null | undefined): "NO" | "P" | "G" | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (NATIONAL_OFFICER_TITLE_RE.test(t)) return "NO";
  if (PROFESSIONAL_TITLE_RE.test(t)) return "P";
  if (GENERAL_SERVICE_TITLE_RE.test(t)) return "G";
  return null;
}

const GROUP_DISPLAY: Record<"NO" | "P" | "G", string> = { NO: "National Officer", P: "Professional", G: "General Service" };

/** EU grades are stored "AD-6", "AST/SC-2", "FG-IV" and written as the EU writes them: "AD 6", "AST/SC 2", "FG IV". */
const EU_GRADE_RE = /^(AD|AST|AST\/SC|FG)-(\d{1,2}|I{1,3}|IV)$/;

/** A stored grade as it is written: "P-3", "AD 6", "FG IV", "GG". */
export function gradeText(grade: string): string {
  const eu = grade.match(EU_GRADE_RE);
  return eu ? `${eu[1]} ${eu[2]}` : grade;
}

/** EU staff grade groups (the EU salary tables apply to them). */
const EU_GROUPS = new Set(["AD", "AST", "AST-SC", "FG"]);

/**
 * The grade to show: the parsed one, or the grade group the title names when no grade was parsed
 * ("National Officer", or "Professional" / "General Service" for IOM's "(P)" / "(G)"). National
 * Officer grades are written out ("NO-B" → "National Officer B"), since "NO" on its own reads as the word.
 */
export function displayGrade(job: { grade: string | null | undefined; title: string | null | undefined }): string | null {
  if (job.grade) {
    const no = job.grade.match(/^NO-?([A-E])$/i);
    return no ? `National Officer ${no[1].toUpperCase()}` : gradeText(job.grade);
  }
  const group = titleGradeGroup(job.title);
  return group ? GROUP_DISPLAY[group] : null;
}

/**
 * Official pay sources, linked (no figures: they change every year and by duty station). Used on
 * /grades and on job pages. Checked on 9 November 2026: ICSC salary scales (Professional and higher,
 * and General Service and related categories), ICSC post adjustment, EU Careers salary tables, EU
 * Staff Regulations.
 */
export const PAY_SOURCES = {
  icscSalaryScales: "https://icsc.un.org/home/salaryscales",
  icscPostAdjustment: "https://icsc.un.org/Home/PostAdjustment",
  euSalaries: "https://eu-careers.europa.eu/benefits-and-pay/salary-and-allowances/salary-levels-and-progression_en",
  euStaffRegulations: "https://eur-lex.europa.eu/eli/reg/1962/31(1)",
} as const;

/** UN common-system grades whose pay the ICSC publishes: Professional, Director, ASG/USG, National Officer, General Service. */
const UN_PAY_GRADE_RE = /^(P-[1-7]|D-[12]|ASG|USG|NO-[A-E]|GS?-\d{1,2})$/;
/** EU staff categories named in a title: AD 5, AST 3, AST-SC 2, contract agent, function group FG IV. */
const EU_PAY_TITLE_RE = /\b(AD|AST)[ -]?\d{1,2}\b|\bAST[- ]SC\b|\bcontract agents?\b|\bFG[ -]?(I{1,3}|IV)\b/i;

/**
 * Where the official pay for this post's grade family is published: the ICSC salary scales for a
 * UN grade (parsed, or the group the title names), the EU salary tables for an EU institution's
 * post whose title names an EU staff category. Null when the family isn't known.
 */
export function payScaleFor(job: { grade: string | null | undefined; title: string | null | undefined; org_type?: string | null }): { family: "UN" | "EU"; label: string; href: string } | null {
  if ((job.grade && UN_PAY_GRADE_RE.test(job.grade)) || (!job.grade && titleGradeGroup(job.title))) {
    return { family: "UN", label: "ICSC salary scales", href: PAY_SOURCES.icscSalaryScales };
  }
  const euGrade = Boolean(job.grade && EU_GROUPS.has(gradeGroupOf(job.grade) ?? ""));
  if (job.org_type === "EU institution" && (euGrade || (job.title && EU_PAY_TITLE_RE.test(job.title)))) {
    return { family: "EU", label: "EU salary levels", href: PAY_SOURCES.euSalaries };
  }
  return null;
}

/** The grade groups shown in the filter (the overlapping "entry" group is kept only for old links). */
export const FILTER_GRADE_GROUPS = GRADE_GROUPS.filter((g) => g.value !== "entry");

const SERVICE_CONTRACT_RE = /^(SB|SC|LICA|NPSA|IPSA|ICS)-/;

/**
 * Which filter group a grade belongs to ("P-3" → "P"), or null for grades outside every group. A
 * group's own value ("NO": a listing whose title gives only the group) belongs to that group.
 */
export function gradeGroupOf(grade: string): string | null {
  if (SERVICE_CONTRACT_RE.test(grade)) return "SC";
  if (FILTER_GRADE_GROUPS.some((g) => g.value === grade)) return grade;
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

/** Short label for a grade filter value: "Professional (P-1 to P-5)", "P-3" or "AD 6". */
export function gradeLabel(value: string): string {
  return GRADE_GROUPS.find((g) => g.value === value)?.name ?? gradeText(value);
}
