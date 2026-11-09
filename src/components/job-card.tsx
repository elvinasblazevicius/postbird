import Link from "next/link";
import type { JobListItem } from "@/lib/jobs";
import { displayGrade } from "@/lib/grades";
import { titleLanguage } from "@/lib/title-language";
import { Flag } from "./flag";
import { SaveButton } from "./job-tools";
import { formatShortDate, jobPath, locationLabel, monogram, NOT_SPECIFIED, relativeDeadline } from "@/lib/site";

/**
 * Organization badge: the organization's icon where we have one, otherwise its short name.
 * Both sit in the same neutral frame, so no organization looks more prominent than another.
 */
export function OrgBadge({ name, short, logo, size = "md" }: { name: string | null; short: string | null; logo?: string | null; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-11 w-11";
  const frame = `${box} flex shrink-0 items-center justify-center rounded-xl border border-rule bg-white`;
  if (logo) {
    return (
      <span aria-hidden="true" className={`${frame} ${size === "lg" ? "p-2" : "p-1.5"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/org-logo/${logo}`} alt="" width={40} height={40} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      </span>
    );
  }
  const text = name ? monogram(name, short) : "–";
  const long = text.length > 4;
  const type = size === "lg" ? (long ? "text-[0.72rem]" : "text-base") : size === "sm" ? (long ? "text-[0.52rem]" : "text-[0.68rem]") : long ? "text-[0.6rem]" : "text-[0.8rem]";
  return (
    <span aria-hidden="true" className={`${frame} ${type} font-semibold tracking-wide text-slate`}>
      {text}
    </span>
  );
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
  const meta: React.ReactNode[] = [
    job.org_name ?? <span className="italic">Organization not in our source</span>,
    where !== NOT_SPECIFIED ? <span className="inline-flex items-center gap-1"><Flag code={job.country_code} />{where}</span> : null,
    ...[grade, job.job_type, job.is_remote && where !== "Remote" ? "Remote" : null, lang ? `In ${lang.name}` : null]
      .filter(Boolean)
      .map((x, i) => <span key={i} className="whitespace-nowrap">{x}</span>),
  ].filter(Boolean);
  return (
    <article className="group relative flex items-start gap-3 bg-paper px-3 py-3 hover:bg-mist sm:px-4">
      <span className="hidden pt-0.5 sm:block"><OrgBadge name={job.org_name} short={job.org_short} logo={job.org_logo} size="sm" /></span>
      <div className="min-w-0 flex-1">
        <H className="font-sans text-[1.02rem] font-semibold leading-snug text-ink">
          <Link href={href} lang={lang?.code} className="after:absolute after:inset-0 group-hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
            {job.title}
          </Link>
        </H>
        <p className="mt-0.5 text-sm leading-snug text-slate">
          {job.is_demo ? <span className="mr-1.5"><Tag tone="demo">Demo data</Tag></span> : null}
          {meta.map((m, i) => (
            <span key={i}>
              {i > 0 ? <span aria-hidden="true" className="px-1">·</span> : null}
              {m}
            </span>
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
