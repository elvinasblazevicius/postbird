import { Fragment } from "react";
import Link from "next/link";
import type { JobListItem } from "@/lib/jobs";
import { countryByCode } from "@/config/countries";
import { displayGrade, localOnlyLabel } from "@/lib/grades";
import { titleLanguage } from "@/lib/title-language";
import { Flag } from "./flag";
import { SaveButton } from "./job-tools";
import { daysUntil, formatShortDate, jobPath, locationLabel, NOT_SPECIFIED } from "@/lib/site";
import { ApplyLink } from "./tracking";
import { applyLinkKind } from "@/lib/apply-link";
import { orgCardName, orgDisplayName } from "@/lib/org-display";

export function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "lilac" | "remote" | "signal" | "demo" }) {
  const tones = {
    plain: "bg-tint text-tint-ink",
    lilac: "bg-lilac text-lilac-ink",
    remote: "bg-remote-bg text-remote",
    signal: "bg-signal-bg text-signal",
    demo: "bg-[#fde8e8] text-[#9b1c1c]",
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.8125rem] font-medium ${tones[tone]}`}>{children}</span>;
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/** Days before a closing date when a card turns red: the daily alerts' reminder comes then (CLOSING_SOON_DAYS in email-templates). */
const URGENT_DAYS = 3;

/** A closing date's colours by how many days are left: red within 3 days, amber within two weeks, light blue after. */
export function deadlineTone(daysLeft: number): string {
  return daysLeft <= URGENT_DAYS ? "bg-due-soon-bg text-due-soon-ink" : daysLeft <= 14 ? "bg-due-mid-bg text-due-mid-ink" : "bg-due-later-bg text-ink";
}

/**
 * The closing date in a card's footer: how long is left and the day, in one tinted pill ("Closes in
 * 2 days  Mon 16 Nov"): red within 3 days, amber within two weeks, light blue after; plain grey text
 * when the employer publishes no date. The words carry the same information as the colour. On wide
 * screens a small calendar link adds the date to the visitor's calendar.
 */
function DeadlinePill({ deadline, jobId }: { deadline: string | null; jobId: number }) {
  const n = daysUntil(deadline);
  if (deadline === null || n === null) {
    // Quiet on purpose: the dated vacancies' closing dates are what should stand out.
    return <p className="text-sm text-slate">No closing date given</p>;
  }
  if (n < 0) return <p className="inline-flex rounded-full bg-due-none-bg px-3 py-1 text-sm font-semibold text-slate">Closed {formatShortDate(deadline)}</p>;
  const lead = n === 0 ? "Closes today" : n === 1 ? "Closes tomorrow" : n <= 60 ? `Closes in ${n} days` : "Closes";
  const day = `${WEEKDAY.format(new Date(`${deadline}T00:00:00Z`))} ${formatShortDate(deadline)}`;
  return (
    <p className={`inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-2xl px-3 py-1 text-sm leading-snug ${deadlineTone(n)}`}>
      <span className="font-semibold">{lead}</span>
      <span className="inline-flex items-center gap-1 opacity-90">
        {day}
        <a
          href={`/api/calendar/${jobId}`}
          rel="nofollow"
          title="Add the closing date to your calendar"
          className="relative z-10 -my-1 hidden rounded-md p-1 opacity-70 hover:bg-paper/60 hover:opacity-100 sm:inline-flex"
        >
          <span className="sr-only">Add the closing date to your calendar</span>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 8.5h14M7 3v3M13 3v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </a>
      </span>
    </p>
  );
}

/** "New" for a listing posted in the last 48 hours, "3d ago" up to 30 days, nothing after that. */
export function postedMarker(job: { published_at: Date | null; first_seen_at: Date; deadline?: string | Date | null }, now: number = Date.now()): { text: string; fresh: boolean } | null {
  // Without the employer's posting date, a vacancy that closes within a week was most likely posted
  // long before we found it: no "New" (or "2d ago") that would suggest otherwise.
  if (!job.published_at && job.deadline && new Date(job.deadline).getTime() - now < 7 * 86_400_000) return null;
  // Closing within 3 days: the closing date is the news, not "New".
  if (job.deadline && new Date(job.deadline).getTime() - now < 3 * 86_400_000) return null;
  const posted = new Date(job.published_at ?? job.first_seen_at).getTime();
  if (Number.isNaN(posted)) return null;
  const hours = (now - posted) / 3_600_000;
  if (hours < 48) return { text: "New", fresh: true };
  const days = Math.floor(hours / 24);
  return days <= 30 ? { text: `${days}d ago`, fresh: false } : null;
}

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

/** "Data Analyst (P-3)" when the grade is shown beside it: "Data Analyst". */
function titleWithoutGrade(title: string, grade: string | null): string {
  if (!grade) return title;
  const t = title.replace(/\s*\((?:P|D|G|GS|NO|NOA|NOB|NOC|NOD|FS|NPSA|IPSA|SB|ICS|LICA|IICA)(?:-?[0-9A-E]{1,2})?\)\s*$/i, "");
  return t.length >= 3 ? t : title;
}

/**
 * One vacancy as a card, in one column: the employer (its abbreviation when it has one) and "New";
 * the title; the facts applicants check first as pills (place, grade, who may apply) with required
 * languages as their own kind of pill; the other details as plain text; then a footer with the
 * closing date and Apply. The bookmark sits in the top-right corner. The whole card is the link to
 * the vacancy's page (its accessible name is the title); the bookmark, the calendar link and Apply
 * (straight to the employer's vacancy) sit above it. Chosen by a three-user panel over three other
 * layouts (calmer, quicker to scan for eligibility).
 */
export function JobCard({ job, headingLevel = 3, posts = 1 }: { job: JobListItem; headingLevel?: 2 | 3; posts?: number }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  const href = jobPath(job);
  const lang = titleLanguage(job.title);
  const grade = displayGrade(job);
  const where = locationLabel(job);
  // "Nationals of Kenya only" for National Officer posts, "Local post · Kenya" for other local posts (localOnlyLabel).
  const localLabel = localOnlyLabel(job, countryByCode(job.country_code)?.name);
  const posted = postedMarker(job);
  const title = titleWithoutGrade(job.title, grade);
  // Every pill has the same shape and a visible border; facts the listing doesn't give get a dashed pill, so each card shows the same row in the same order.
  const pill = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.8125rem] leading-5";
  const plain = `${pill} border-[#bfd0e3] bg-paper text-ink`;
  const missing = `${pill} border-dashed border-[#bfd0e3] text-slate`;
  // Required languages besides English (two at most): their own kind of pill, easy to spot.
  const languages = (job.languages ?? []).slice(0, 2);
  // Always in this order: contract, remote, experience, language of the posting, number of posts, when it was posted.
  const details = [
    job.job_type,
    job.is_remote && where !== "Remote" && where !== NOT_SPECIFIED ? "Remote" : null,
    job.min_experience_years ? `${job.min_experience_years}+ years experience` : null,
    lang ? `In ${lang.name}` : null,
    posts > 1 ? `${posts} posts` : null,
    posted && !posted.fresh ? `Posted ${posted.text}` : null,
  ].filter((x): x is string => Boolean(x));
  return (
    <article className="group relative rounded-xl border border-[#d3e0ee] bg-paper px-4 py-3.5 shadow-[0_1px_3px_rgba(11,31,58,0.08)] transition-[border-color,box-shadow] duration-150 hover:border-sky-rule hover:shadow-[0_4px_14px_rgba(11,99,206,0.10)]">
      <span className="absolute right-2.5 top-2.5">
        <SaveButton compact job={{ id: job.id, path: href, title: job.title, org: job.org_name }} />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pr-12">
        <p className="flex min-h-[1.5rem] items-center gap-x-2 text-sm leading-snug [&>*:not(:first-child)]:shrink-0">
          {/* No employer name when the source gives none (the listing on the employer's site has it): nothing guessed here. */}
          {job.org_name ? <span className="min-w-0 truncate font-semibold text-slate" title={orgDisplayName(job.org_name, job.org_short)}>{orgCardName(job.org_name, job.org_short)}</span> : null}
          {posted?.fresh ? <span className="rounded-full bg-remote-bg px-2.5 py-0.5 text-[0.75rem] font-bold leading-5 text-remote">New</span> : null}
          {job.is_demo ? <Tag tone="demo">Demo data</Tag> : null}
        </p>
        <H className="font-sans text-[1.1rem] font-bold leading-snug tracking-normal text-ink">
          {/* At most two lines in a list; the full title is on the job page (and in the tooltip). */}
          <Link href={href} lang={lang?.code} title={job.title} className="line-clamp-2 transition-colors duration-150 after:absolute after:inset-0 after:rounded-xl group-hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
            {title}
          </Link>
        </H>
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
        {/* Always in this order: place, grade, who may apply, languages. */}
        {where !== NOT_SPECIFIED ? <li className={plain}><Flag code={job.country_code} />{where}</li>
          : job.is_remote ? <li className={plain}>Remote</li> : <li className={missing}>Duty station not stated</li>}
        {/* The grade is the first thing most applicants check, so it stands out from the other details. */}
        {grade ? <li className={`${pill} border-[#c3d8ee] bg-tint font-semibold text-ink`}>{grade}</li> : <li className={missing}>Grade not stated</li>}
        {/* Who may apply: local posts (usually nationals only) or internationally recruited grades (Professional, Director, Field Service). */}
        {localLabel ? <li className={`${pill} border-[#f0d58a] bg-due-mid-bg font-medium text-due-mid-ink`}>{localLabel}</li>
          : job.grade && /^(P|D|FS)-/.test(job.grade) ? <li className={`${pill} border-[#b5dcf7] bg-sky-wash font-medium text-accent`}>International post</li> : null}
        {languages.map((l) => <li key={l} className={`${pill} border-[#d6ccf3] bg-[#f1edfb] font-medium text-[#4a3b8f]`}>{l} required</li>)}
      </ul>
      {details.length ? <p className="mt-1.5 text-[0.8125rem] leading-snug text-slate">{details.join(" · ")}</p> : null}
      {/* Date and Apply share one row on every width: the date's day moves under "Closes in…" when space is short. */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-rule pt-2.5 [&>p]:min-w-0">
        <DeadlinePill deadline={job.deadline} jobId={job.id} />
        {/* Straight to the employer's vacancy, above the card's link (relative z-10). A careers home page says so. */}
        {job.apply_url ? (
          <ApplyLink
            href={job.apply_url}
            jobId={job.id}
            className="group/apply relative z-10 ml-auto inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-brand px-4 text-[0.95rem] font-bold text-white hover:bg-accent active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
/** `phoneExtra`: shown on phones only, after the first `after` cards (the search results' alert button, so the first cards come first). */
/**
 * `firstPage`: a keyword search's first page, where a list that has no title match at all says so
 * at the top. A search's results whose titles hold the words come first (searchJobs); the first one
 * that only mentions them in its description gets a line above it.
 */
export function JobList({ jobs, headingLevel = 3, mobileLimit, phoneExtra, firstPage = true }: { jobs: JobListItem[]; headingLevel?: 2 | 3; mobileLimit?: number; phoneExtra?: { after: number; node: React.ReactNode }; firstPage?: boolean }) {
  const folded = foldSameVacancies(jobs);
  const extraAt = phoneExtra ? Math.min(phoneExtra.after, folded.length) : -1;
  const mentionAt = folded.findIndex(({ job }) => job.title_match === false);
  const mentionLine = mentionAt > 0 || (mentionAt === 0 && firstPage);
  return (
    <ul className="grid gap-3">
      {folded.map(({ job: j, posts }, i) => (
        <Fragment key={j.id}>
          {i === mentionAt && mentionLine ? (
            <li className="mt-2 flex items-center gap-3 text-[0.9rem] text-slate" data-mentioned-only>
              <span className="h-px flex-1 bg-rule" aria-hidden="true" />
              <span>{i === 0 ? (folded.length === 1 ? "Your words aren't in its title: this vacancy mentions them in the description" : "No title holds your words: these vacancies mention them in the description") : "Also mentioned in the description"}</span>
              <span className="h-px flex-1 bg-rule" aria-hidden="true" />
            </li>
          ) : null}
          {i === extraAt ? <li className="sm:hidden">{phoneExtra!.node}</li> : null}
          <li className={mobileLimit !== undefined && i >= mobileLimit ? "max-sm:hidden" : undefined}>
            <JobCard job={j} headingLevel={headingLevel} posts={posts} />
          </li>
        </Fragment>
      ))}
      {extraAt === folded.length && extraAt >= 0 ? <li className="sm:hidden">{phoneExtra!.node}</li> : null}
    </ul>
  );
}
