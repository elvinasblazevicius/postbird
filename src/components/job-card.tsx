import Link from "next/link";
import type { JobListItem } from "@/lib/jobs";
import { Flag } from "./flag";
import { categoryName, deadlineLabel, formatDate, jobPath, locationLabel, monogram, NOT_SPECIFIED, postedLabel } from "@/lib/site";

export function OrgBadge({ name, short, logo, size = "md" }: { name: string | null; short: string | null; logo?: string | null; size?: "md" | "lg" }) {
  if (logo) {
    const box = size === "lg" ? "h-14 w-14 p-2" : "h-11 w-11 p-1.5";
    return (
      <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-xl border border-rule bg-white shadow-[0_1px_2px_rgba(11,27,63,0.06)]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/org-logo/${logo}`} alt="" width={40} height={40} loading="lazy" decoding="async" className="h-full w-full object-contain" />
      </span>
    );
  }
  const text = name ? monogram(name, short) : "–";
  const long = text.length > 4;
  const dims = size === "lg" ? `h-14 w-14 ${long ? "text-[0.72rem]" : "text-base"}` : `h-11 w-11 ${long ? "text-[0.6rem]" : "text-[0.8rem]"}`;
  return (
    <span
      aria-hidden="true"
      className={`${dims} flex shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--tint),#dff5ff)] font-semibold tracking-wide text-brand`}
    >
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

/** Deadline column: the date that drives every application, set large like a calendar stub. */
function DeadlineStub({ deadline }: { deadline: string | null }) {
  const label = deadlineLabel(deadline);
  if (!deadline || !label) {
    return (
      <div className="text-right text-sm text-slate">
        <div className="text-xs">Deadline</div>
        <div className="mt-0.5">{NOT_SPECIFIED}</div>
      </div>
    );
  }
  const [day, month] = formatDate(deadline).split(" ");
  return (
    <div className="text-right">
      <div className="text-xs text-slate">Closes</div>
      <div className="font-display text-2xl font-semibold leading-tight text-ink">
        {day} <span className="text-lg font-medium">{month}</span>
      </div>
      <div className={`text-xs ${label.urgent ? "font-semibold text-signal" : "text-slate"}`}>{label.text}</div>
    </div>
  );
}

export function JobCard({ job, headingLevel = 3 }: { job: JobListItem; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as "h2" | "h3";
  const href = jobPath(job);
  return (
    <article className="card-lift group relative rounded-2xl border border-rule bg-paper p-5 hover:border-[color-mix(in_srgb,var(--brand)_45%,var(--rule))] sm:p-6">
      <div className="flex gap-4">
        <OrgBadge name={job.org_name} short={job.org_short} logo={job.org_logo} />
        <div className="min-w-0 flex-1">
          <H className="font-display text-[1.28rem] font-semibold leading-snug text-ink">
            <Link href={href} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">
              {job.title}
            </Link>
          </H>
          <p className="mt-1 text-[0.95rem] text-ink">
            {job.org_name ?? <span className="text-slate">Organization {NOT_SPECIFIED.toLowerCase()}</span>}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[0.95rem] text-slate"><Flag code={job.country_code} />{locationLabel(job)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {job.is_demo ? <Tag tone="demo">Demo data</Tag> : null}
            {job.is_remote ? <Tag tone="remote">Remote / home-based</Tag> : null}
            {job.category !== "other" ? <Tag>{categoryName(job.category)}</Tag> : null}
            {job.grade ? <Tag tone="lilac">{job.grade}</Tag> : null}
            {job.job_type ? <Tag tone="lilac">{job.job_type}</Tag> : null}
            <span className="text-[0.8rem] text-slate">{postedLabel(job.published_at, job.first_seen_at)}</span>
          </div>
        </div>
        <div className="hidden w-28 shrink-0 flex-col justify-between sm:flex">
          <DeadlineStub deadline={job.deadline} />
          <span className="mt-3 self-end text-sm font-medium text-accent group-hover:underline" aria-hidden="true">
            View details
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-rule pt-3 sm:hidden">
        <span className="text-sm text-slate">
          {job.deadline ? (
            <>
              Closes {formatDate(job.deadline)}
              {deadlineLabel(job.deadline)?.urgent ? <strong className="ml-1 text-signal">({deadlineLabel(job.deadline)!.text.toLowerCase()})</strong> : null}
            </>
          ) : (
            <>Deadline {NOT_SPECIFIED.toLowerCase()}</>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap pl-3 text-sm font-medium text-accent">View details</span>
      </div>
    </article>
  );
}

export function JobList({ jobs, headingLevel = 3 }: { jobs: JobListItem[]; headingLevel?: 2 | 3 }) {
  return (
    <ul className="space-y-3">
      {jobs.map((j) => (
        <li key={j.id}>
          <JobCard job={j} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

/** Compact card for grids (homepage). Same facts as JobCard, stacked vertically. */
export function JobTile({ job }: { job: JobListItem }) {
  const dl = deadlineLabel(job.deadline);
  return (
    <article className="card-lift group relative flex h-full flex-col rounded-2xl border border-rule bg-paper p-5 hover:border-[color-mix(in_srgb,var(--brand)_45%,var(--rule))]">
      <div className="flex items-start justify-between gap-3">
        <OrgBadge name={job.org_name} short={job.org_short} logo={job.org_logo} />
        <div className="text-right">
          {job.deadline && dl ? (
            <>
              <div className="text-xs text-slate">Closes</div>
              <div className="font-display text-lg font-semibold leading-tight text-ink">{formatDate(job.deadline).replace(/ \d{4}$/, "")}</div>
              <div className={`text-xs ${dl.urgent ? "font-semibold text-signal" : "text-slate"}`}>{dl.text}</div>
            </>
          ) : (
            <>
              <div className="text-xs text-slate">Deadline</div>
              <div className="text-sm text-slate">{NOT_SPECIFIED}</div>
            </>
          )}
        </div>
      </div>
      <h3 className="mt-4 font-display text-[1.18rem] font-semibold leading-snug text-ink">
        <Link href={jobPath(job)} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">{job.title}</Link>
      </h3>
      <p className="mt-1.5 text-[0.95rem] text-ink">{job.org_name ?? <span className="text-slate">Organization {NOT_SPECIFIED.toLowerCase()}</span>}</p>
      <p className="flex items-center gap-1.5 text-[0.95rem] text-slate"><Flag code={job.country_code} />{locationLabel(job)}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.is_demo ? <Tag tone="demo">Demo data</Tag> : null}
        {job.is_remote ? <Tag tone="remote">Remote</Tag> : null}
        {job.category !== "other" ? <Tag>{categoryName(job.category)}</Tag> : null}
        {job.grade ? <Tag tone="lilac">{job.grade}</Tag> : null}
      </div>
      <div className="min-h-4 flex-1" />
      <div className="flex items-center justify-between border-t border-rule pt-3">
        <span className="text-xs text-slate">{postedLabel(job.published_at, job.first_seen_at)}</span>
        <span className="text-sm font-medium text-accent group-hover:underline" aria-hidden="true">View details</span>
      </div>
    </article>
  );
}

export function JobGrid({ jobs }: { jobs: JobListItem[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((j) => (
        <li key={j.id}>
          <JobTile job={j} />
        </li>
      ))}
    </ul>
  );
}
