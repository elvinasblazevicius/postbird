import Link from "next/link";
import type { JobListItem } from "@/lib/jobs";
import { countryByCode } from "@/config/countries";
import { displayGrade, localOnlyLabel } from "@/lib/grades";
import { titleLanguage } from "@/lib/title-language";
import { Flag } from "./flag";
import { SaveButton } from "./job-tools";
import { LISTING_SETTINGS } from "@/config/import";
import { daysUntil, formatShortDate, jobPath, locationLabel, NOT_SPECIFIED } from "@/lib/site";
import { ApplyLink } from "./tracking";
import { applyLinkKind } from "@/lib/apply-link";
import { orgDisplayName } from "@/lib/org-display";

export function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "lilac" | "remote" | "signal" | "demo" }) {
  const tones = {
    plain: "bg-tint text-tint-ink",
    lilac: "bg-lilac text-lilac-ink",
    remote: "bg-remote-bg text-remote",
    signal: "bg-signal-bg text-signal",
    demo: "bg-[#fde8e8] text-[#9b1c1c]",
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.8rem] font-medium ${tones[tone]}`}>{children}</span>;
}

/**
 * A closing date in words: "Closes 12 Nov" and how many days are left ("3 days", "today",
 * "tomorrow"; none beyond 60 days), urgent (red) only within LISTING_SETTINGS.closingSoonDays.
 * Null without a published closing date.
 */
export function closingChip(deadline: string | null): { date: string; left: string | null; urgent: boolean } | null {
  const n = daysUntil(deadline);
  if (n === null || n < 0) return null;
  const left = n === 0 ? "today" : n === 1 ? "tomorrow" : n <= 60 ? `${n} days` : null;
  return { date: `Closes ${formatShortDate(deadline)}`, left, urgent: n <= LISTING_SETTINGS.closingSoonDays };
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/** A closing date's colours by how many days are left: red within a week, amber within two, light blue after. */
export function deadlineTone(daysLeft: number): string {
  return daysLeft <= LISTING_SETTINGS.closingSoonDays ? "bg-due-soon-bg text-due-soon-ink" : daysLeft <= 14 ? "bg-due-mid-bg text-due-mid-ink" : "bg-due-later-bg text-ink";
}

/**
 * The closing date on a card: how long is left, then the day ("Closes in 7 days", "Thu 19 Nov").
 * Its colour says how soon: red within LISTING_SETTINGS.closingSoonDays (a week), amber within two
 * weeks, light blue after that, grey when the employer publishes no date. The words carry the same
 * information, so the colour is never the only signal. On wide screens a small calendar link adds
 * the date to the visitor's calendar.
 */
function DeadlineBox({ deadline, jobId }: { deadline: string | null; jobId: number }) {
  const n = daysUntil(deadline);
  if (deadline === null || n === null || n < 0) {
    return <p className="rounded-[10px] bg-due-none-bg px-3 py-2 text-[0.95rem] font-semibold leading-snug text-slate">No closing date given</p>;
  }
  const tone = deadlineTone(n);
  const lead = n === 0 ? "Closes today" : n === 1 ? "Closes tomorrow" : n <= 60 ? `Closes in ${n} days` : "Closes";
  const day = `${WEEKDAY.format(new Date(`${deadline}T00:00:00Z`))} ${formatShortDate(deadline)}`;
  return (
    <p className={`flex flex-wrap items-center justify-between gap-x-2.5 gap-y-0.5 rounded-[10px] px-3 py-2 leading-snug ${tone}`}>
      <span className="font-bold">{lead}</span>
      <span className="inline-flex items-center gap-1.5 text-sm">
        {day}
        <a
          href={`/api/calendar/${jobId}`}
          rel="nofollow"
          title="Add the closing date to your calendar"
          className="relative z-10 -my-1 -mr-1.5 hidden rounded-md p-1 opacity-70 hover:bg-paper/60 hover:opacity-100 sm:inline-flex"
        >
          <span className="sr-only">Add the closing date to your calendar</span>
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 8.5h14M7 3v3M13 3v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </a>
      </span>
    </p>
  );
}

/** "New" for a listing posted in the last 48 hours, "3d ago" up to 30 days, nothing after that. */
export function postedMarker(job: { published_at: Date | null; first_seen_at: Date }, now: number = Date.now()): { text: string; fresh: boolean } | null {
  const posted = new Date(job.published_at ?? job.first_seen_at).getTime();
  if (Number.isNaN(posted)) return null;
  const hours = (now - posted) / 3_600_000;
  if (hours < 48) return { text: "New", fresh: true };
  const days = Math.floor(hours / 24);
  return days <= 30 ? { text: `${days}d ago`, fresh: false } : null;
}

/** The organization's type in a few words, for the badge beside its name. */
const ORG_TYPE_LABEL: Record<string, string> = {
  "UN system": "UN system",
  "EU institution": "EU institution",
  "International financial institution": "Development bank",
  "International organization": "International organization",
  NGO: "NGO",
};

/** The same vacancy posted more than once (identical title, organization, place and closing date). */
export function sameVacancyKey(j: Pick<JobListItem, "title" | "org_name" | "country_code" | "city" | "location_text" | "deadline">): string {
  return [j.title.trim().toLowerCase(), j.org_name ?? "", j.country_code ?? "", (j.city ?? j.location_text ?? "").toLowerCase(), j.deadline ?? ""].join("|");
}

/** One card per vacancy: later identical posts are folded into the first, which counts them. */
export function foldSameVacancies<T extends Parameters<typeof sameVacancyKey>[0]>(jobs: T[]): { job: T; posts: number }[] {
  const out = new Map<string, { job: T; posts: number }>();
  for (const j of jobs) {
    const k = sameVacancyKey(j);
    const hit = out.get(k);
    if (hit) hit.posts++;
    else out.set(k, { job: j, posts: 1 });
  }
  return [...out.values()];
}

/**
 * One vacancy as a card. Left: the organization in full with its type, the title, then the details
 * as chips (place, grade, contract, experience, languages). Right: the closing date and the Apply
 * button, one above the other at the same width, with the bookmark in the card's top-right corner
 * (on phones the date and Apply run the card's full width). The whole card is the link to the
 * vacancy's page (its accessible name is the title); the bookmark, the calendar link and Apply
 * (straight to the employer's vacancy) sit above it.
 */
export function JobCard({ job, headingLevel = 3, posts = 1 }: { job: JobListItem; headingLevel?: 2 | 3; stamp?: boolean; posts?: number }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  const href = jobPath(job);
  const lang = titleLanguage(job.title);
  const grade = displayGrade(job);
  const where = locationLabel(job);
  // "Nationals of Kenya only" for National Officer posts, "Local post · Kenya" for other local posts (localOnlyLabel).
  const localLabel = localOnlyLabel(job, countryByCode(job.country_code)?.name);
  const posted = postedMarker(job);
  const typeLabel = job.org_type ? ORG_TYPE_LABEL[job.org_type] : null;
  const chip = "inline-flex items-center gap-1.5 rounded-lg border border-rule px-2 py-0.5";
  const details = [
    job.job_type,
    job.is_remote && where !== "Remote" ? "Remote" : null,
    lang ? `In ${lang.name}` : null,
    job.min_experience_years ? `${job.min_experience_years}+ years experience` : null,
    // Required languages besides English (two at most): a quick yes/no for the reader.
    ...(job.languages ?? []).slice(0, 2).map((l) => `${l} required`),
    posts > 1 ? `${posts} posts` : null,
  ].filter((x): x is string => Boolean(x));
  return (
    <article className="group relative flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-xl border border-rule bg-paper px-4 py-3.5 transition-[border-color,box-shadow] duration-150 hover:border-sky-rule hover:shadow-[0_4px_14px_rgba(11,99,206,0.10)] motion-safe:animate-[rise-in_220ms_ease-out_both]">
      <div className="flex min-w-0 flex-[999_1_24rem] flex-col gap-1.5">
        {/* Phones: room on the right for the bookmark in the card's corner. */}
        <p className="flex min-h-[2.25rem] flex-wrap content-center items-center gap-x-2 gap-y-1 pr-12 text-sm leading-snug sm:min-h-0 sm:pr-0">
          {job.org_name
            ? <span className="font-bold text-ink">{orgDisplayName(job.org_name, job.org_short)}</span>
            : <span className="italic text-slate">Organization not in our source</span>}
          {typeLabel ? <span className="rounded-md bg-tint px-2 py-0.5 text-[0.8125rem] font-semibold text-tint-ink">{typeLabel}</span> : null}
          {posted?.fresh ? <span className="rounded-md bg-[#ffe680] px-2 py-0.5 text-[0.8125rem] font-bold text-ink">New</span> : null}
          {localLabel ? <span className="rounded-md border border-rule px-2 py-0.5 text-[0.8125rem] font-medium text-slate">{localLabel}</span> : null}
          {job.is_demo ? <Tag tone="demo">Demo data</Tag> : null}
        </p>
        <H className="font-sans text-[1.1rem] font-bold leading-snug tracking-normal text-ink">
          {/* At most two lines in a list; the full title is on the job page (and in the tooltip). */}
          <Link href={href} lang={lang?.code} title={job.title} className="line-clamp-2 transition-colors duration-150 after:absolute after:inset-0 after:rounded-xl group-hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
            {job.title}
          </Link>
        </H>
        <ul className="flex flex-wrap gap-x-2 gap-y-1.5 text-sm text-tint-ink">
          {where !== NOT_SPECIFIED ? <li className={chip}><Flag code={job.country_code} />{where}</li> : null}
          {/* The grade is the first thing most applicants check, so it stands out from the other details. */}
          {grade ? <li className="inline-flex items-center rounded-lg border border-sky-rule bg-tint px-2 py-0.5 font-semibold text-ink">{grade}</li> : null}
          {details.map((d) => <li key={d} className={chip}>{d}</li>)}
          {posted && !posted.fresh ? <li className="inline-flex items-center py-0.5 text-slate"><span className="sr-only">Posted </span>{posted.text}</li> : null}
        </ul>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:min-w-[16.25rem] sm:flex-[1_1_20rem] sm:grid-cols-[minmax(0,1fr)_2.75rem] sm:gap-x-2.5">
        <div className="sm:col-start-1 sm:row-start-1"><DeadlineBox deadline={job.deadline} jobId={job.id} /></div>
        <span className="absolute right-2.5 top-2.5 sm:static sm:col-start-2 sm:row-start-1 sm:self-start">
          <SaveButton compact job={{ id: job.id, path: href, title: job.title, org: job.org_name }} />
        </span>
        {/* Straight to the employer's vacancy, above the card's link (relative z-10). A careers home page says so. */}
        {job.apply_url ? (
          <ApplyLink
            href={job.apply_url}
            jobId={job.id}
            className="group/apply relative z-10 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-brand px-4 text-[0.95rem] font-bold text-white hover:bg-accent active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:col-start-1 sm:row-start-2"
          >
            {applyLinkKind(job.apply_url, job.title) === "homepage" ? "Careers site" : "Apply"}
            <span className="sr-only">: {job.title}{job.org_name ? `, ${job.org_name}` : ""} (opens the employer&apos;s site in a new tab)</span>
            <svg viewBox="0 0 16 16" className="h-3 w-3 transition-transform duration-150 motion-safe:group-hover/apply:-translate-y-px motion-safe:group-hover/apply:translate-x-px" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </ApplyLink>
        ) : null}
      </div>
    </article>
  );
}

/** A list of cards, one per vacancy (identical posts folded into one). `mobileLimit`: how many show on phones. */
export function JobList({ jobs, headingLevel = 3, mobileLimit }: { jobs: JobListItem[]; headingLevel?: 2 | 3; mobileLimit?: number; columns?: 1 | 2; stamp?: boolean }) {
  return (
    <ul className="grid gap-2.5">
      {foldSameVacancies(jobs).map(({ job: j, posts }, i) => (
        <li key={j.id} className={mobileLimit !== undefined && i >= mobileLimit ? "max-sm:hidden" : undefined}>
          <JobCard job={j} headingLevel={headingLevel} posts={posts} />
        </li>
      ))}
    </ul>
  );
}

/** Kept for older callers: the same list. */
export function JobGrid({ jobs, mobileLimit }: { jobs: JobListItem[]; mobileLimit?: number; stamp?: boolean }) {
  return <JobList jobs={jobs} mobileLimit={mobileLimit} />;
}
