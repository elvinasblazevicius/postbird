/**
 * The site's guides that help with one vacancy, most specific first, for the vacancy page. Pure, so
 * the rules are tested without a page.
 */

export type GuideLink = { href: string; label: string };

type JobForGuides = {
  title: string | null | undefined;
  grade: string | null | undefined;
  job_type: string | null | undefined;
  org_type: string | null | undefined;
  org_name?: string | null;
};

const JPO_RE = /\bjunior professional officers?\b|\bJPO\b/i;
const UNV_RE = /\bUN ?V\b|\bUN (?:youth |university |national |international )?volunteers?\b/i;
const YPP_RE = /\byoung professionals? programme\b|\bYPP\b/i;
/** Grades the salary calculator covers. */
const PD_GRADE_RE = /^(P-[1-5]|D-[12])$/;

export function guidesFor(job: JobForGuides): GuideLink[] {
  const title = job.title ?? "";
  const un = job.org_type === "UN system";
  const eu = job.org_type === "EU institution";
  const out: GuideLink[] = [];

  if (JPO_RE.test(title)) out.push({ href: "/guides/jpo-programme", label: "How the JPO programme works" });
  if (un && YPP_RE.test(title)) out.push({ href: "/guides/un-young-professionals-programme", label: "The UN Young Professionals Programme" });
  if (un && job.job_type === "Internship") out.push({ href: "/guides/un-internships", label: "Which UN internships are paid" });
  if (job.job_type === "Volunteer" && (un || UNV_RE.test(title))) out.push({ href: "/guides/un-volunteers", label: "How UN Volunteers works" });
  if (un && job.grade && PD_GRADE_RE.test(job.grade)) {
    out.push({ href: `/guides/un-salaries?grade=${job.grade}#calculator`, label: `What a ${job.grade} earns` });
  }
  // The Blue Book is the Commission's own programme; EU agencies run separate traineeships.
  if (eu && job.job_type === "Traineeship" && (/\bblue book\b/i.test(title) || /^European Commission\b/i.test(job.org_name ?? ""))) out.push({ href: "/guides/eu-blue-book-traineeship", label: "The EU Blue Book traineeship" });
  if (eu) out.push({ href: "/guides/epso-exams", label: "How EPSO exams work" });
  if (un) out.push({ href: "/guides/how-to-read-a-un-vacancy", label: "How to read a UN vacancy" });

  // De-duplicated, and at most three: a short list gets read.
  return out.filter((g, i) => out.findIndex((x) => x.href === g.href) === i).slice(0, 3);
}
