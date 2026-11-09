import Link from "next/link";
import siteConfig from "@site-config";
import { closingSoonJobs, searchJobs, type JobListItem } from "@/lib/jobs";
import { displayGrade, isLocalOnly, localOnlyShort } from "@/lib/grades";
import { daysUntil, formatDate, jobPath, locationLabel, NOT_SPECIFIED } from "@/lib/site";

/** Paid alerts' "Closing in the next 3 days" (CLOSING_SOON_DAYS in src/lib/email-templates.ts, not imported here: that module is server-email code). */
const CLOSING_SOON_DAYS = 3;

/** Used only when there are no listings to build the example from. Clearly labelled as illustrative. */
const ILLUSTRATIVE = [
  { title: "Programme Officer (Education)", meta: "A UN agency · Nairobi, Kenya · P-3 · Closes in 3 weeks" },
  { title: "Monitoring and Evaluation Specialist", meta: "An international NGO · Remote / home-based · Closes in 2 weeks" },
  { title: "Finance Associate", meta: "A development bank · Manila, Philippines · Closes in 10 days" },
];

/** "UNICEF · Nairobi, Kenya · P-3 · Closes 30 Nov 2026": the same compact line as the emails (jobMeta in src/lib/email-templates.ts). */
function jobMeta(j: JobListItem): string {
  const where = locationLabel(j);
  return [j.org_name ?? "Organization not in our source", where === NOT_SPECIFIED ? null : where, displayGrade(j), localOnlyShort(j), j.deadline ? `Closes ${formatDate(j.deadline)}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** A count in a subject line, capped so it stays short: "26", "999+". */
export function cappedCount(n: number): string {
  return n > 999 ? "999+" : n.toLocaleString("en-US");
}

/** Rows the example shows before "+N more". */
const EXAMPLE_ROWS = 3;

/**
 * The rows for the example: newest first, listings with a grade first (an international grade, as
 * local-only posts are already left out by the search where that applies), at most EXAMPLE_ROWS.
 */
function pickRows(jobs: JobListItem[]): JobListItem[] {
  const graded = jobs.filter((j) => j.grade && !isLocalOnly(j));
  return [...graded, ...jobs.filter((j) => !graded.includes(j))].slice(0, EXAMPLE_ROWS);
}

function Rows({ rows }: { rows: { key: string | number; title: string; meta: string; href?: string }[] }) {
  return (
    <ul className="border-t border-rule">
      {rows.map((r) => (
        <li key={r.key} className="border-b border-rule py-2">
          {r.href ? (
            <Link href={r.href} className="text-[0.94rem] font-semibold leading-snug text-ink hover:text-accent hover:underline">{r.title}</Link>
          ) : (
            <p className="text-[0.94rem] font-semibold leading-snug text-ink">{r.title}</p>
          )}
          <p className="text-[0.8125rem] leading-snug text-slate">{r.meta}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * "What an alert looks like": a rendered copy of the alert email (the layout of alertEmail /
 * weeklyEmail in src/lib/email-templates.ts: subject, the new matches, and for paid alerts the
 * "Closing in the next 3 days" section), filled with current listings. `kind` "weekly" shows the
 * free weekly email instead (no closing-soon section).
 */
export async function AlertExample({ heading = "What an alert looks like", kind = "daily" }: { heading?: string; kind?: "daily" | "weekly" }) {
  // Weekly: the open listings posted in the past 7 days (as the weekly email). Daily: a search that leaves out local-only
  // posts (the hidelocal filter, the SQL rule), with what was posted in the past day, or the past week on a quiet day.
  // Demo listings never count.
  const pick = (posted: "1" | "7") =>
    searchJobs({ posted, sort: "newest", hidelocal: kind === "daily" || undefined, excludeDemo: true }, 30).catch(() => ({ items: [] as JobListItem[], total: 0 }));
  const [first, closing] = await Promise.all([pick(kind === "daily" ? "1" : "7"), kind === "daily" ? closingSoonJobs(12).catch(() => []) : Promise.resolve([])]);
  // A quiet day: the daily example is built from the past week instead, and says so.
  const pastWeek = kind === "daily" && first.total < EXAMPLE_ROWS;
  const found = pastWeek ? await pick("7") : first;
  const jobs = pickRows(found.items);
  const soon = closing
    .filter((j) => !j.is_demo && (daysUntil(j.deadline) ?? 99) <= CLOSING_SOON_DAYS && !jobs.some((x) => x.id === j.id) && !isLocalOnly(j))
    .slice(0, 2);
  const real = jobs.length > 0;
  const n = real ? Math.max(found.total, jobs.length) : ILLUSTRATIVE.length;
  const moreCount = real ? n - jobs.length : 0;
  const label = kind === "daily" ? "All new vacancies, without local-only posts" : "All new vacancies";
  const subject = kind === "weekly"
    ? `${cappedCount(n)} new international ${n === 1 ? "vacancy" : "vacancies"} this week`
    : pastWeek && real
      ? `Example: ${cappedCount(n)} new ${n === 1 ? "vacancy" : "vacancies"} this week`
      : `${cappedCount(n)} new ${n === 1 ? "vacancy matches" : "vacancies match"} your search`;
  const intro = !real
    ? "Illustrative example"
    : pastWeek
      ? "An example built from the past week’s listings (a quiet day had too few to show)."
      : "Example built from current listings";
  const rows = real
    ? jobs.map((j) => ({ key: j.id, title: j.title, meta: jobMeta(j), href: jobPath(j) }))
    : ILLUSTRATIVE.map((j) => ({ key: j.title, title: j.title, meta: j.meta }));

  return (
    <section aria-labelledby="sample-heading">
      <h2 id="sample-heading" className="text-xl font-semibold text-ink">{heading}</h2>
      <p className="mt-1 text-sm text-slate">{intro}</p>
      <figure className="mt-3 rounded-xl border border-rule bg-mist p-2 sm:p-3">
        <figcaption className="px-2 pb-2 pt-1 text-[0.8125rem] leading-relaxed text-slate">
          <span className="block"><span className="text-ink">From:</span> {siteConfig.name}</span>
          <span className="block"><span className="text-ink">Subject:</span> <span className="font-semibold text-ink">{subject}</span></span>
        </figcaption>
        <div className="rounded-lg border border-rule bg-paper">
          <p className="border-b border-rule px-4 py-2.5 font-display text-lg font-semibold text-brand">{siteConfig.name}</p>
          <div className="px-4 py-4">
            <p className="font-display text-[1.3rem] font-semibold leading-tight text-ink">
              {kind === "weekly" ? "This week’s new vacancies" : "New vacancies for your saved searches"}
            </p>
            <p className="mt-1 text-sm text-slate">
              {kind === "weekly"
                ? "The newest vacancies of the past week. Apply on each employer’s own website."
                : pastWeek && real
                  ? `New on ${siteConfig.name} in the past week. Apply on each employer’s own website.`
                  : `New on ${siteConfig.name} since yesterday’s email. Apply on each employer’s own website.`}
            </p>
            {kind === "daily" ? (
              <p className="mt-4 text-[0.95rem] font-semibold text-ink">
                {label} <span className="font-normal text-slate">({cappedCount(n)} new)</span>
              </p>
            ) : null}
            <div className={kind === "daily" ? "mt-1" : "mt-3"}><Rows rows={rows} /></div>
            {moreCount > 0 ? <p className="mt-2 text-[0.8125rem] font-medium text-slate">+{cappedCount(moreCount)} more</p> : null}
            {kind === "daily" ? (
              soon.length ? (
                <>
                  <p className="mt-5 text-[0.95rem] font-semibold text-ink">Closing in the next {CLOSING_SOON_DAYS} days</p>
                  <p className="text-[0.8125rem] text-slate">Open vacancies that match your saved searches. Each one is listed here once.</p>
                  <div className="mt-1"><Rows rows={soon.map((j) => ({ key: j.id, title: j.title, meta: jobMeta(j), href: jobPath(j) }))} /></div>
                </>
              ) : (
                <p className="mt-4 text-[0.8125rem] text-slate">
                  When a matching vacancy closes in the next {CLOSING_SOON_DAYS} days, it appears in a section of its own at the end, once.
                </p>
              )
            ) : null}
          </div>
          <p className="border-t border-rule px-4 py-2.5 text-xs text-slate">Your account · Unsubscribe</p>
        </div>
      </figure>
    </section>
  );
}
