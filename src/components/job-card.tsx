import Link from "next/link";
import { Fragment } from "react";
import type { JobListItem } from "@/lib/jobs";
import { countryByCode } from "@/config/countries";
import { displayGrade, localOnlyLabel } from "@/lib/grades";
import { titleLanguage } from "@/lib/title-language";
import { Flag } from "./flag";
import { SaveButton } from "./job-tools";
import { LISTING_SETTINGS } from "@/config/import";
import { daysUntil, formatShortDate, jobPath, locationLabel, NOT_SPECIFIED, siteConfig } from "@/lib/site";
import { ClosingPostmark } from "./postmark";
import { ApplyLink } from "./tracking";
import { applyLinkKind } from "@/lib/apply-link";

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

/** Closing date at the right of a row as a postmark ("Closes / 12 Nov", red with "in 3 days" when close): the home page's "Closing soon". */
function Deadline({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="block w-[4.5rem] text-center text-xs leading-snug text-slate">No closing date in our source</span>;
  return <ClosingPostmark deadline={deadline} />;
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

/**
 * The closing date in a list row: an upright chip of one width with tabular figures (see
 * .postmark-chip in globals.css: the postmark ink and a light double ring, no tilt) around
 * "Closes 12 Nov · 3 days", red only when it closes within a week. Read as "Closes 12 Nov, 3 days
 * left". The round, tilted postmark stays on job pages and in "Closing soon".
 */
function StampChip({ chip }: { chip: NonNullable<ReturnType<typeof closingChip>> }) {
  const [, label, date] = chip.date.match(/^(Closes) (.*)$/) ?? [null, "", chip.date];
  return (
    <span className={`postmark-chip ${chip.urgent ? "postmark-urgent" : ""}`}>
      {label ? <span className="postmark-chip-label">{label}</span> : null}
      <span className="postmark-chip-date">{date}</span>
      {chip.left ? (
        <span className="postmark-chip-left">
          <span aria-hidden="true">·</span>
          <span className="sr-only">, </span>
          {chip.left}
          {/^\d/.test(chip.left) ? <span className="sr-only"> left</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** Closing date at the right of a list row: the stamp chip, or a quiet note when the source gives none. */
function DateChip({ deadline }: { deadline: string | null }) {
  const chip = closingChip(deadline);
  if (!chip) return <span className="whitespace-nowrap text-xs text-slate/70">No closing date</span>;
  return <StampChip chip={chip} />;
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

function PlaceWithFlag({ code, where }: { code: string | null; where: string }) {
  const [first, ...rest] = where.split(" ");
  return (
    <>
      <span className="whitespace-nowrap"><Flag code={code} className="mr-1 align-[-0.05em]" />{first}</span>
      {rest.length ? ` ${rest.join(" ")}` : null}
    </>
  );
}

/** The organization's type in two or three letters' worth, for scanning a list without logos. */
const ORG_TYPE_SHORT: Record<string, string> = {
  "UN system": "UN",
  "EU institution": "EU",
  "International financial institution": "Dev. bank",
  "International organization": "Intl org",
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

function IconLink({ href, label, children, external = false }: { href: string; label: string; children: React.ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      title={label}
      rel={external ? "nofollow" : undefined}
      className="relative z-10 hidden rounded-md p-1.5 text-slate hover:bg-tint hover:text-accent sm:inline-flex"
    >
      <span className="sr-only">{label}</span>
      {children}
    </a>
  );
}

/**
 * One vacancy as a compact two-line row: the title, then organization · location · grade · type,
 * with the closing date on the right (on phones, at the end of that line). The whole row is the link (its accessible name is the title);
 * the bookmark button and the Apply button (straight to the employer's vacancy) sit above it.
 */
export function JobCard({ job, headingLevel = 3, stamp = false, posts = 1 }: { job: JobListItem; headingLevel?: 2 | 3; stamp?: boolean; posts?: number }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  const href = jobPath(job);
  const lang = titleLanguage(job.title);
  const grade = displayGrade(job);
  const where = locationLabel(job);
  // "Nationals of Kenya only" for National Officer posts, "Local post · Kenya" for other local posts (localOnlyLabel).
  const localLabel = localOnlyLabel(job, countryByCode(job.country_code)?.name);
  const posted = postedMarker(job);
  const chip = closingChip(job.deadline);
  // Each detail ends with its own separator, glued to its last word by a no-break space, so a
  // wrapped line can end with "·" but never start with one.
  type Meta = { node: React.ReactNode; nowrap?: boolean };
  const meta = ([
    {
      node: job.org_name ? (
        <>
          {job.org_name}
          {job.org_type && ORG_TYPE_SHORT[job.org_type] ? (
            <span className="ml-1.5 inline-flex rounded border border-rule px-1 text-[0.7rem] font-medium leading-[1.15rem] text-slate align-[0.05em]">{ORG_TYPE_SHORT[job.org_type]}</span>
          ) : null}
        </>
      ) : <span className="italic">Organization not in our source</span>,
    },
    // The flag stays with the first word of the place, so a wrapped line never starts with a lone flag or name.
    where !== NOT_SPECIFIED ? { node: <PlaceWithFlag code={job.country_code} where={where} /> } : null,
    ...[
      grade,
      job.job_type,
      job.is_remote && where !== "Remote" ? "Remote" : null,
      lang ? `In ${lang.name}` : null,
      job.min_experience_years ? `${job.min_experience_years}+ yrs experience` : null,
      // Required languages besides English (two at most): a quick yes/no for the reader.
      ...(job.languages ?? []).slice(0, 2).map((l) => `${l} required`),
      posts > 1 ? `${posts} posts` : null,
    ]
      .filter(Boolean)
      .map((x) => ({ node: x, nowrap: true })),
    posted ? {
      node: <span className={posted.fresh ? "font-medium text-ink/80" : ""}>{posted.fresh ? "New" : <><span className="sr-only">Posted </span>{posted.text}</>}</span>,
      nowrap: true,
    } : null,
  ] as (Meta | null)[]).filter((m): m is Meta => m !== null);
  return (
    <article className="group relative flex items-start gap-3 bg-paper px-3 py-3 transition-colors duration-150 hover:bg-mist sm:px-4 motion-safe:animate-[rise-in_220ms_ease-out_both]">
      <div className="min-w-0 flex-1">
        <H className="font-sans text-[1.02rem] font-semibold leading-snug text-ink">
          {/* At most two lines in a list; the full title is on the job page (and in the tooltip). */}
          <Link href={href} lang={lang?.code} title={job.title} className="line-clamp-2 transition-colors duration-150 after:absolute after:inset-0 group-hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
            {job.title}
          </Link>
        </H>
        <p className="mt-0.5 text-sm leading-snug text-slate">
          {job.is_demo ? <span className="mr-1.5"><Tag tone="demo">Demo data</Tag></span> : null}
          {localLabel ? (
            <span className="mr-1.5 inline-flex rounded border border-rule px-1.5 text-[0.75rem] font-medium leading-[1.35rem] text-slate">
              {localLabel}
            </span>
          ) : null}
          {meta.map((m, i) => (
            <Fragment key={i}>
              <span className={m.nowrap ? "whitespace-nowrap" : undefined}>
                {m.node}
                {/* The dot is for the eye; a screen reader hears a comma. */}
                {i < meta.length - 1 ? <><span aria-hidden="true">{"\u00a0·"}</span><span className="sr-only">, </span></> : null}
              </span>
              {i < meta.length - 1 ? " " : null}
            </Fragment>
          ))}
          {/* Phones: the closing date ends the meta line, so the title keeps the row's full width. It wraps to its own line when it doesn't fit. */}
          {!stamp && chip ? (
            <span className="sm:hidden">
              {/* The stamp's own ring separates it from the details, so no "·" before it. */}
              <span className="sr-only">, </span>{" "}
              <StampChip chip={chip} />
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 self-center text-right text-sm">
        <div className="flex items-center gap-1">
          {stamp ? <Deadline deadline={job.deadline} /> : <span className={chip ? "max-sm:hidden" : ""}><DateChip deadline={job.deadline} /></span>}
          {job.deadline ? (
            <IconLink href={`/api/calendar/${job.id}`} label="Add the closing date to your calendar" external>
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 8.5h14M7 3v3M13 3v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </IconLink>
          ) : null}
          <IconLink href={`${siteConfig.freeWeeklyEmail ? "/alerts" : "/pricing/trial"}?search=${encodeURIComponent(`category=${job.category}`)}`} label="Email me jobs like this">
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5v2.6L4 13.5h12l-1.5-2.9V8A4.5 4.5 0 0 0 10 3.5ZM8.2 15.5a1.9 1.9 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          </IconLink>
          <SaveButton compact job={{ id: job.id, path: href, title: job.title, org: job.org_name }} />
        </div>
        {/* Straight to the employer's vacancy, above the row's link (relative z-10). A careers home page says so. */}
        {job.apply_url ? (
          <ApplyLink
            href={job.apply_url}
            jobId={job.id}
            className="group/apply relative z-10 inline-flex items-center gap-1 rounded-md border border-accent/40 px-2.5 py-1 text-[0.8rem] font-semibold text-accent hover:border-accent hover:bg-accent hover:text-white active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {applyLinkKind(job.apply_url) === "homepage" ? "Careers site" : "Apply"}
            <span className="sr-only">: {job.title}{job.org_name ? `, ${job.org_name}` : ""} (opens the employer&apos;s site in a new tab)</span>
            <svg viewBox="0 0 16 16" className="h-3 w-3 transition-transform duration-150 motion-safe:group-hover/apply:-translate-y-px motion-safe:group-hover/apply:translate-x-px" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </ApplyLink>
        ) : null}
      </div>
    </article>
  );
}

/** `stamp`: the closing date as a postmark instead of a chip (the home page's "Closing soon"). */
export function JobList({ jobs, headingLevel = 3, mobileLimit, columns = 1, stamp = false }: { jobs: JobListItem[]; headingLevel?: 2 | 3; mobileLimit?: number; columns?: 1 | 2; stamp?: boolean }) {
  const two = columns === 2;
  return (
    <ul className={`overflow-hidden rounded-xl border-x border-t border-rule bg-paper ${two ? "lg:grid lg:grid-cols-2" : ""}`}>
      {foldSameVacancies(jobs).map(({ job: j, posts }, i) => (
        <li
          key={j.id}
          className={`border-b border-rule ${mobileLimit !== undefined && i >= mobileLimit ? "max-sm:hidden" : ""} ${two && i % 2 === 0 ? "lg:border-r" : ""}`}
        >
          <JobCard job={j} headingLevel={headingLevel} stamp={stamp} posts={posts} />
        </li>
      ))}
    </ul>
  );
}

/** Homepage list: the same compact rows, two columns on wide screens, the first `mobileLimit` on phones. */
export function JobGrid({ jobs, mobileLimit, stamp = false }: { jobs: JobListItem[]; mobileLimit?: number; stamp?: boolean }) {
  return <JobList jobs={jobs} columns={2} mobileLimit={mobileLimit} stamp={stamp} />;
}
