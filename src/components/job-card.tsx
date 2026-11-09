import Link from "next/link";
import { Fragment } from "react";
import type { JobListItem } from "@/lib/jobs";
import { countryByCode } from "@/config/countries";
import { displayGrade, isLocalOnly } from "@/lib/grades";
import { titleLanguage } from "@/lib/title-language";
import { Flag } from "./flag";
import { SaveButton } from "./job-tools";
import { formatShortDate, jobPath, locationLabel, monogram, NOT_SPECIFIED, relativeDeadline } from "@/lib/site";

/**
 * Organization badge: always a text monogram (the organization's short name, e.g. "WFP", "MSF",
 * or its initials) in the same neutral frame. No logos, so no organization looks more prominent
 * than another and nothing suggests the organization endorses the site.
 */
export function OrgBadge({ name, short, size = "md" }: { name: string | null; short: string | null; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-10 w-10" : "h-11 w-11";
  const frame = `${box} flex shrink-0 items-center justify-center rounded-xl border border-rule bg-white`;
  const text = badgeText(name ? monogram(name, short) : "–");
  // Six letters (UNESCO, UNICEF) are set a little tighter so they fit at a readable size.
  const tracking = text.length >= 6 ? "tracking-[-0.04em]" : "tracking-[-0.02em]";
  return (
    <span aria-hidden="true" className={`${frame} ${badgeFontSize(text, size)} ${tracking} overflow-hidden whitespace-nowrap px-px text-center font-semibold leading-none text-slate`}>
      {text}
    </span>
  );
}

/**
 * Font sizes by badge length (up to 3, 4, 5 and 6 characters): one line, never split, smaller for
 * longer monograms but never below 0.5625rem (9px). Measured to fit the widest (UNESCO, UNHCR) in each box.
 */
const BADGE_SIZES: Record<"sm" | "md" | "lg", [string, string, string, string]> = {
  sm: ["text-[0.75rem]", "text-[0.68rem]", "text-[0.6rem]", "text-[0.5625rem]"],
  md: ["text-[0.85rem]", "text-[0.76rem]", "text-[0.66rem]", "text-[0.6rem]"],
  lg: ["text-base", "text-[0.92rem]", "text-[0.82rem]", "text-[0.72rem]"],
};

export function badgeFontSize(text: string, size: "sm" | "md" | "lg"): string {
  return BADGE_SIZES[size][Math.min(Math.max(text.length, 3), 6) - 3];
}

/**
 * The badge text on one line: the monogram (see monogram in src/lib/site.ts: a configured badge
 * label, a short name of up to 5 characters, a known acronym such as UNICEF, or initials). Anything
 * longer is cut to its first 5 characters, which monogram never produces.
 */
export function badgeText(text: string): string {
  const t = text.trim();
  return t.length <= 6 ? t : t.slice(0, 5);
}

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

/** Closing date at the right of a row: "12 Nov" (with the year when it isn't this year) and "in 5 days" when close. */
function Deadline({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-xs text-slate">No closing date in our source</span>;
  const rel = relativeDeadline(deadline);
  return (
    <span className="block">
      <span className="block text-xs text-slate">Closes</span>
      <span className="block whitespace-nowrap font-semibold text-ink">{formatShortDate(deadline)}</span>
      {rel && rel.urgent ? <span className="block whitespace-nowrap text-xs font-semibold text-signal">{rel.text}</span> : null}
    </span>
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

function PlaceWithFlag({ code, where }: { code: string | null; where: string }) {
  const [first, ...rest] = where.split(" ");
  return (
    <>
      <span className="whitespace-nowrap"><Flag code={code} className="mr-1 align-[-0.05em]" />{first}</span>
      {rest.length ? ` ${rest.join(" ")}` : null}
    </>
  );
}

/**
 * One vacancy as a compact two-line row: the title, then organization · location · grade · type,
 * with the closing date on the right. The whole row is the link (its accessible name is the title);
 * the bookmark button sits above it.
 */
export function JobCard({ job, headingLevel = 3 }: { job: JobListItem; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  const href = jobPath(job);
  const lang = titleLanguage(job.title);
  const grade = displayGrade(job);
  const where = locationLabel(job);
  const local = isLocalOnly(job);
  const localCountry = local ? countryByCode(job.country_code)?.name : undefined;
  // "Nationals of Kenya only" is said only for National Officer grades; other local posts (General
  // Service, service contracts) are usually open to legal residents too, so they are "Local post".
  const nationalOfficer = Boolean(grade?.startsWith("National Officer"));
  const localLabel = !local ? null : nationalOfficer && localCountry ? `Nationals of ${localCountry} only` : localCountry ? `Local post · ${localCountry}` : "Local post";
  const posted = postedMarker(job);
  // Each detail ends with its own separator, glued to its last word by a no-break space, so a
  // wrapped line can end with "·" but never start with one.
  type Meta = { node: React.ReactNode; nowrap?: boolean };
  const meta = ([
    { node: job.org_name ?? <span className="italic">Organization not in our source</span> },
    // The flag stays with the first word of the place, so a wrapped line never starts with a lone flag or name.
    where !== NOT_SPECIFIED ? { node: <PlaceWithFlag code={job.country_code} where={where} /> } : null,
    ...[grade, job.job_type, job.is_remote && where !== "Remote" ? "Remote" : null, lang ? `In ${lang.name}` : null]
      .filter(Boolean)
      .map((x) => ({ node: x, nowrap: true })),
    posted ? {
      node: <span className={posted.fresh ? "font-medium text-ink/80" : ""}>{posted.fresh ? "New" : <><span className="sr-only">Posted </span>{posted.text}</>}</span>,
      nowrap: true,
    } : null,
  ] as (Meta | null)[]).filter((m): m is Meta => m !== null);
  return (
    <article className="group relative flex items-start gap-3 bg-paper px-3 py-3 hover:bg-mist sm:px-4">
      <span className="hidden pt-0.5 sm:block"><OrgBadge name={job.org_name} short={job.org_short} size="sm" /></span>
      <div className="min-w-0 flex-1">
        <H className="font-sans text-[1.02rem] font-semibold leading-snug text-ink">
          <Link href={href} lang={lang?.code} className="after:absolute after:inset-0 group-hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
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
                {i < meta.length - 1 ? <span aria-hidden="true">{"\u00a0·"}</span> : null}
              </span>
              {i < meta.length - 1 ? " " : null}
            </Fragment>
          ))}
        </p>
      </div>
      <div className="flex shrink-0 items-start gap-1 text-right text-sm">
        <Deadline deadline={job.deadline} />
        <SaveButton compact job={{ id: job.id, path: href, title: job.title, org: job.org_name }} />
      </div>
    </article>
  );
}

export function JobList({ jobs, headingLevel = 3, mobileLimit, columns = 1 }: { jobs: JobListItem[]; headingLevel?: 2 | 3; mobileLimit?: number; columns?: 1 | 2 }) {
  const two = columns === 2;
  return (
    <ul className={`overflow-hidden rounded-xl border-x border-t border-rule bg-paper ${two ? "lg:grid lg:grid-cols-2" : ""}`}>
      {jobs.map((j, i) => (
        <li
          key={j.id}
          className={`border-b border-rule ${mobileLimit !== undefined && i >= mobileLimit ? "max-sm:hidden" : ""} ${two && i % 2 === 0 ? "lg:border-r" : ""}`}
        >
          <JobCard job={j} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

/** Homepage list: the same compact rows, two columns on wide screens, the first `mobileLimit` on phones. */
export function JobGrid({ jobs, mobileLimit }: { jobs: JobListItem[]; mobileLimit?: number }) {
  return <JobList jobs={jobs} columns={2} mobileLimit={mobileLimit} />;
}
