import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { AlertSignup } from "@/components/alert-signup";
import { JobList, OrgBadge, Tag } from "@/components/job-card";
import { Breadcrumbs } from "@/components/page-header";
import { ApplyLink, TrackedLink, TrackOnMount } from "@/components/tracking";
import { categoryBySlug } from "@/config/categories";
import { countryByCode } from "@/config/countries";
import { LISTING_SETTINGS } from "@/config/import";
import { getJob, similarJobs, type JobDetail } from "@/lib/jobs";
import { absoluteUrl, categoryName, escapeHtml, jsonLd, deadlineLabel, formatDate, jobPath, locationLabel, NOT_SPECIFIED, parseJobParam, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const loadJob = cache(async (param: string) => {
  const id = parseJobParam(param);
  if (!id) return null;
  const job = await getJob(id);
  if (!job || job.status === "removed") return null;
  return job;
});

function isOpen(job: JobDetail) {
  return job.status === "active" && (!job.deadline || job.deadline >= new Date().toISOString().slice(0, 10));
}

function hasDescription(job: JobDetail) {
  return Boolean(job.description_html || job.summary);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await loadJob((await params).slug);
  if (!job) return { title: "Vacancy not found", robots: { index: false } };
  const where = locationLabel(job);
  const title = `${job.title}${job.org_name ? ` — ${job.org_name}` : ""}${where !== NOT_SPECIFIED ? `, ${where}` : ""}`;
  const description = job.summary
    ? job.summary.slice(0, 155)
    : `${job.title}${job.org_name ? ` at ${job.org_name}` : ""}${where !== NOT_SPECIFIED ? ` in ${where}` : ""}.${job.deadline ? ` Apply by ${formatDate(job.deadline)}` : ""} on the official website.`;
  const indexable = isOpen(job) && !job.is_demo && (hasDescription(job) || LISTING_SETTINGS.indexJobsWithoutDescription);
  return {
    title,
    description,
    alternates: { canonical: jobPath(job) },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: jobPath(job), type: "article" },
  };
}

function jobPostingLd(job: JobDetail) {
  // Only emit structured data for open jobs whose required fields are visible on the page.
  if (!isOpen(job) || job.is_demo || !job.org_name || !hasDescription(job)) return null;
  const country = countryByCode(job.country_code);
  const hasPlace = Boolean(job.city || country);
  if (!hasPlace && !(job.is_remote && country)) return null;
  const employmentType: Record<string, string> = {
    Internship: "INTERN", Consultancy: "CONTRACTOR", Temporary: "TEMPORARY", Volunteer: "VOLUNTEER", "Part-time": "PART_TIME",
  };
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description_html ?? `<p>${escapeHtml(job.summary ?? "")}</p>`,
    datePosted: (job.published_at ?? job.first_seen_at).toISOString(),
    hiringOrganization: { "@type": "Organization", name: job.org_name },
    url: absoluteUrl(jobPath(job)),
    directApply: false,
  };
  if (job.deadline) ld.validThrough = `${job.deadline}T23:59:59Z`;
  if (job.job_type && employmentType[job.job_type]) ld.employmentType = employmentType[job.job_type];
  if (job.reference) ld.identifier = { "@type": "PropertyValue", name: job.org_name, value: job.reference };
  if (hasPlace) {
    ld.jobLocation = {
      "@type": "Place",
      address: { "@type": "PostalAddress", ...(job.city ? { addressLocality: job.city } : {}), ...(country ? { addressCountry: country.code } : {}) },
    };
  }
  if (job.is_remote) {
    ld.jobLocationType = "TELECOMMUTE";
    if (country) ld.applicantLocationRequirements = { "@type": "Country", name: country.name };
  }
  return ld;
}

function Fact({ label, children, muted }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-rule py-3 last:border-b-0 sm:grid-cols-[11rem_1fr]">
      <dt className="text-sm text-slate">{label}</dt>
      <dd className={`text-[0.98rem] ${muted ? "text-slate" : "text-ink"}`}>{children}</dd>
    </div>
  );
}

export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  const job = await loadJob(slug);
  if (!job) notFound();
  const canonical = jobPath(job);
  if (`/jobs/${slug}` !== canonical) permanentRedirect(canonical);

  const open = isOpen(job);
  const similar = await similarJobs(job);
  const ld = jobPostingLd(job);
  const dl = deadlineLabel(job.deadline);
  const category = categoryBySlug(job.category);
  const where = locationLabel(job);
  const source = job.sources.find((s) => s.source_title)?.source_title;

  const applyButton = (
    <ApplyLink
      href={job.apply_url}
      jobId={job.id}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3.5 text-base font-semibold text-white hover:bg-accent"
    >
      Apply on Official Website
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
    </ApplyLink>
  );

  return (
    <>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} /> : null}
      <TrackOnMount event={{ type: "job_view", jobId: job.id }} />

      <div className="bg-candy-soft border-b border-rule">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Breadcrumbs
            items={[
              { href: "/", label: "Home" },
              { href: "/jobs", label: "Jobs" },
              ...(job.org_slug ? [{ href: `/organizations/${job.org_slug}`, label: job.org_short ?? job.org_name ?? "Organization" }] : []),
              { href: canonical, label: job.title.length > 48 ? job.title.slice(0, 46) + "…" : job.title },
            ]}
          />
          <div className="mt-5 flex gap-4">
            <OrgBadge name={job.org_name} short={job.org_short} size="lg" />
            <div className="min-w-0">
              <h1 className="text-[1.9rem] font-semibold leading-tight text-ink sm:text-[2.4rem]">{job.title}</h1>
              <p className="mt-2 text-lg text-ink">
                {job.org_slug ? <Link href={`/organizations/${job.org_slug}`} className="hover:underline">{job.org_name}</Link> : <span className="text-slate">Organization not specified</span>}
              </p>
              <p className="text-slate">{where}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {job.is_demo ? <Tag tone="demo">Demo data — not a real vacancy</Tag> : null}
                {!open ? <Tag tone="signal">Closed</Tag> : null}
                {job.is_remote ? <Tag tone="remote">Remote / home-based</Tag> : null}
                {job.category !== "other" ? <Tag>{categoryName(job.category)}</Tag> : null}
                {job.grade ? <Tag tone="lilac">{job.grade}</Tag> : null}
                {job.job_type ? <Tag tone="lilac">{job.job_type}</Tag> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          {!open ? (
            <div role="status" className="mb-8 rounded-xl border border-[#f0d9b5] bg-signal-bg p-5">
              <p className="font-semibold text-signal">This vacancy has closed.</p>
              <p className="mt-1 text-ink">
                {job.deadline ? `Applications closed on ${formatDate(job.deadline)}.` : "It is no longer listed by the source."} See similar open roles below.
              </p>
            </div>
          ) : null}

          <section aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="text-[1.45rem] font-semibold text-ink">Vacancy details</h2>
            <dl className="mt-3 rounded-xl border border-rule px-5">
              <Fact label="Organization" muted={!job.org_name}>{job.org_name ?? NOT_SPECIFIED}</Fact>
              <Fact label="Location" muted={where === NOT_SPECIFIED}>{where}</Fact>
              {job.location_text && job.location_text !== where ? <Fact label="As listed">{job.location_text}</Fact> : null}
              <Fact label="Remote / home-based" muted={!job.is_remote}>{job.is_remote ? "Yes" : NOT_SPECIFIED}</Fact>
              <Fact label="Category">
                {category && category.slug !== "other" ? <Link href={`/categories/${category.slug}`} className="hover:underline">{category.name}</Link> : "Other"}
              </Fact>
              <Fact label="Job type" muted={!job.job_type}>{job.job_type ?? NOT_SPECIFIED}</Fact>
              <Fact label="Grade / level" muted={!job.grade}>{job.grade ?? NOT_SPECIFIED}</Fact>
              <Fact label="Posted" muted={!job.published_at}>{job.published_at ? formatDate(job.published_at) : NOT_SPECIFIED}</Fact>
              <Fact label="Application deadline" muted={!job.deadline}>
                {job.deadline ? (
                  <>
                    {formatDate(job.deadline)}
                    {open && dl ? <span className={`ml-2 text-sm ${dl.urgent ? "font-semibold text-signal" : "text-slate"}`}>({dl.text.toLowerCase()})</span> : null}
                  </>
                ) : (
                  NOT_SPECIFIED
                )}
              </Fact>
              {job.reference ? <Fact label="Vacancy reference">{job.reference}</Fact> : null}
            </dl>
          </section>

          <section aria-labelledby="desc-heading" className="mt-10">
            <h2 id="desc-heading" className="text-[1.45rem] font-semibold text-ink">About the role</h2>
            {job.description_html ? (
              <div className="prose-job mt-4" dangerouslySetInnerHTML={{ __html: job.description_html }} />
            ) : job.summary ? (
              <>
                <p className="mt-4 max-w-[68ch] text-[1.0625rem] leading-relaxed text-ink">{job.summary}</p>
                <p className="mt-3 text-slate">The full description, requirements and application instructions are on the official vacancy page.</p>
              </>
            ) : (
              <p className="mt-4 max-w-[68ch] leading-relaxed text-slate">
                The description for this vacancy is published on the organization&apos;s website. Open the official posting to read the full terms of reference, requirements and how to apply.
              </p>
            )}
          </section>

          <section className="mt-8 rounded-xl border border-rule p-5 text-sm leading-relaxed text-slate" aria-label="Source">
            <p>
              <span className="font-medium text-ink">Source:</span> {job.apply_host}
              {source ? <> via {source}</> : null}. Last checked {formatDate(job.last_seen_at)}.
            </p>
            <p className="mt-1">
              {siteConfig.name} lists this vacancy for discovery only. Details can change, so confirm them on the official posting. Applications are made only on the employer&apos;s website.
            </p>
          </section>

          {open ? <div className="mt-8 lg:hidden">{applyButton}</div> : null}

          {similar.length ? (
            <section className="mt-14" aria-labelledby="similar-heading">
              <h2 id="similar-heading" className="text-[1.45rem] font-semibold text-ink">Similar open vacancies</h2>
              <div className="mt-5"><JobList jobs={similar} /></div>
            </section>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-rule p-5">
            {open ? (
              <>
                <p className="text-sm text-slate">Deadline</p>
                <p className="font-display text-2xl font-semibold text-ink">{job.deadline ? formatDate(job.deadline) : NOT_SPECIFIED}</p>
                {dl ? <p className={`text-sm ${dl.urgent ? "font-semibold text-signal" : "text-slate"}`}>{dl.text}</p> : null}
                <div className="mt-4">{applyButton}</div>
                {job.deadline ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <a href={`/api/calendar/${job.id}`} className="rounded-lg border border-rule px-3 py-2 text-center font-medium text-accent hover:bg-tint" rel="nofollow">
                      Add to calendar
                    </a>
                    <TrackedLink href={`/pricing/trial?remind=${job.id}`} event="premium_cta_click" source="deadline-reminder" className="rounded-lg border border-rule px-3 py-2 text-center font-medium text-accent hover:bg-tint">
                      Remind me
                    </TrackedLink>
                  </div>
                ) : null}
                <p className="mt-3 text-xs leading-relaxed text-slate">Opens {job.apply_host} in a new tab. {siteConfig.name} doesn&apos;t take applications and never charges a fee to apply.</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-ink">Applications closed</p>
                <Link href={`/jobs?category=${job.category}`} className="mt-3 block rounded-lg bg-brand px-4 py-3 text-center font-semibold text-white hover:bg-accent">
                  See open {categoryName(job.category)} jobs
                </Link>
              </>
            )}
          </div>
          <div className="mt-5 rounded-xl border border-rule bg-mist p-5">
            <p className="font-display text-lg font-semibold text-ink">Get roles like this by email</p>
            <p className="mt-1 mb-3 text-sm text-slate">{siteConfig.freeWeeklyEmail ? "A free Monday email with new vacancies." : "Alerts for the roles and places you choose."}</p>
            <AlertSignup source="job-page" />
          </div>
        </aside>
      </div>
    </>
  );
}
