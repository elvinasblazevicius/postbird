import type { Metadata } from "next";
import { Flag } from "@/components/flag";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { EpsoBook, isEuInstitution } from "@/components/epso-book";
import { JobList, OrgBadge, Tag } from "@/components/job-card";
import { ClosingPostmark } from "@/components/postmark";
import { SaveButton, ShareButton } from "@/components/job-tools";
import { Breadcrumbs } from "@/components/page-header";
import { ApplyLink, TrackedLink, TrackOnMount } from "@/components/tracking";
import { categoryBySlug } from "@/config/categories";
import { countryByCode } from "@/config/countries";
import { LISTING_SETTINGS } from "@/config/import";
import { applyLinkKind } from "@/lib/apply-link";
import { displayGrade, isLocalOnly, payScaleFor } from "@/lib/grades";
import { ORG_TYPES } from "@/config/regions";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { moreInCategory, organizationPostingMix, POSTING_MIX_DAYS, searchJobs, type JobDetail } from "@/lib/jobs";
import { usuallyPosts } from "@/lib/org-profile";
import { orgInText } from "@/lib/org-names";
import { applyTarget } from "@/lib/recruitment-system";
import { extraLocation } from "@/lib/place-text";
import { titleLanguage } from "@/lib/title-language";
import { absoluteUrl, categoryName, escapeHtml, jsonLd, deadlineLabel, formatDate, jobPath, locationLabel, NOT_SPECIFIED, siteConfig } from "@/lib/site";
import { isJobOpen as isOpen, loadJob } from "./job-data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

function hasDescription(job: JobDetail) {
  return Boolean(job.description_html || job.summary);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await loadJob((await params).slug);
  if (!job) return { title: "Vacancy not found" }; // the 404 page adds the noindex tag
  if (!isOpen(job)) return { title: `Vacancy closed: ${job.title}`, robots: { index: false, follow: true } };
  const where = locationLabel(job);
  const title = `${job.title}${job.org_name ? ` — ${job.org_name}` : ""}${where !== NOT_SPECIFIED ? `, ${where}` : ""}`;
  const description = job.summary
    ? job.summary.slice(0, 155)
    : `${job.title}${job.org_name ? ` at ${job.org_name}` : ""}${where !== NOT_SPECIFIED ? ` in ${where}` : ""}.${job.deadline ? ` Apply by ${formatDate(job.deadline)}` : ""} on the employer's website.`;
  const indexable = !job.is_demo && (hasDescription(job) || LISTING_SETTINGS.indexJobsWithoutDescription);
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
  // JobPosting needs the full description: only listings from a "full" content-policy feed have it.
  if (job.is_demo || !job.org_name || !job.description_html || job.content_policy !== "full") return null;
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

/** "Get new data and analytics vacancies by email" (keeps short acronyms such as IT). */
function categoryPhrase(slug: string): string {
  if (slug === "other") return "";
  const name = categoryName(slug);
  return /^[A-Z]{2,4}$/.test(name) ? `${name} ` : `${name.charAt(0).toLowerCase()}${name.slice(1)} `;
}

/** One known detail in the compact strip (a dt/dd pair in its own div, which <dl> allows). */
function Fact({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-slate">{label}</dt>
      <dd className="mt-0.5 text-[0.95rem] text-ink">{children}</dd>
    </div>
  );
}

/** One row of the "At a glance" list: label on the left, value on the right (stacked on narrow phones). */
function GlanceRow({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-x-4 gap-y-0.5 py-2.5 min-[420px]:grid-cols-[9.5rem_1fr] ${className}`}>
      <dt className="text-sm text-slate">{label}</dt>
      <dd className="min-w-0 text-[0.95rem] text-ink">{children}</dd>
    </div>
  );
}

/**
 * Required languages, then the others on their own line: those called desirable and those named as
 * alternatives ("German or Italian"), any of which may do (desirable_languages, see
 * detectLanguageRequirements in src/lib/feeds/extract.ts). Null when the source names neither.
 */
function Languages({ job }: { job: JobDetail }) {
  const required = job.languages?.length ? job.languages.join(", ") : null;
  const desirable = job.desirable_languages?.length ? job.desirable_languages.join(", ") : null;
  if (!required && !desirable) return null;
  return (
    <>
      {required}
      {required && desirable ? <br /> : null}
      {desirable ? <span className={required ? "text-sm text-slate" : undefined}>Desirable or one of several: {desirable}</span> : null}
    </>
  );
}

/** One known detail of the vacancy, shown as a row (At a glance), a cell (the facts strip) or inline (a thin page's header). */
type Detail = { label: string; node: React.ReactNode };

export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  const job = await loadJob(slug);
  if (!job) notFound();
  const canonical = jobPath(job);
  if (`/jobs/${slug}` !== canonical) permanentRedirect(canonical);
  // Closed vacancies are a 404 that says so and lists similar open ones (see layout.tsx).
  if (!isOpen(job)) notFound();

  const description = hasDescription(job);
  const [more, orgOpen, mix] = await Promise.all([
    moreInCategory(job).catch(() => []),
    // How many open vacancies the organization has (this one included), for "4 other open vacancies at IOM".
    job.org_slug ? searchJobs({ org: [job.org_slug] }, 1).then((r) => r.total).catch(() => 0) : Promise.resolve(0),
    // What the organization usually posts, for pages without a description (src/lib/org-profile.ts).
    !description && job.org_slug ? organizationPostingMix(job.org_slug).catch(() => null) : Promise.resolve(null),
  ]);
  const ld = jobPostingLd(job);
  const dl = deadlineLabel(job.deadline);
  const category = categoryBySlug(job.category);
  const where = locationLabel(job);
  const grade = displayGrade(job);
  const localOnly = isLocalOnly(job);
  const lang = titleLanguage(job.title);
  const dutyCountry = countryByCode(job.country_code)?.name ?? null;
  const publishedPlace = where !== NOT_SPECIFIED ? extraLocation(where, job.location_text) : null;
  const pay = payScaleFor(job);
  const experience = job.min_experience_years != null ? `${job.min_experience_years}+ ${job.min_experience_years === 1 ? "year" : "years"}` : null;
  // "Who can apply" only where we know the usual rule: local-only posts. For any other post we make
  // no general claim (eligibility differs by employer: EU citizenship, member-country nationality,
  // work permits); that advice is part of the one note below instead.
  const whoCanApply = localOnly ? `Usually only nationals or legal residents of ${dutyCountry ?? "the duty-station country"}.` : null;
  // One quiet line for everything the page doesn't show (it makes no claim about what the employer's page has beyond the full details).
  const detailsLine = (
    <p className="mt-3 text-sm text-slate">
      Full details are on the{" "}
      <a href={job.apply_url} target="_blank" rel="nofollow noopener noreferrer" className="text-accent underline">
        employer&apos;s page<span className="sr-only"> (opens in a new tab)</span>
      </a>
      .
    </p>
  );
  // The employer's type (its landing page) and what it usually posts, worked out from its listings.
  const typePage = EMPLOYER_TYPE_PAGES.find((p) => p.orgtype === ORG_TYPES.find((t) => t.type === job.org_type)?.value);
  const usually = mix ? usuallyPosts(mix) : null;
  // The guide is about UN vacancies (grades, UN languages): linked from UN-system vacancies only.
  const unSystem = job.org_type === "UN system";
  const orgRef = orgInText(job.org_name, job.org_short);
  // Where Apply goes, in plain words: "Opens IOM's recruitment system (Oracle)"; the address only for the organization's own site.
  const homepage = applyLinkKind(job.apply_url) === "homepage";
  const target = applyTarget({ url: job.apply_url, host: job.apply_host, orgName: job.org_name, orgShort: job.org_short, homepage });
  const otherAtOrg = Math.max(0, orgOpen - 1);
  // The free weekly email when it is on; otherwise the paid alerts' trial page.
  const alertHref = `${siteConfig.freeWeeklyEmail ? "/alerts" : "/pricing/trial"}?search=${encodeURIComponent(`category=${job.category}`)}`;

  const applyButton = (
    <ApplyLink
      href={job.apply_url}
      jobId={job.id}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3.5 text-base font-semibold text-white hover:bg-accent"
    >
      {homepage ? "Find it on the careers site" : "Apply"}
      <span className="sr-only"> (opens the employer&apos;s site in a new tab)</span>
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
    </ApplyLink>
  );

  /** The closing date as a postmark, how long is left, and the time-zone caveat (desktop card and phone box). */
  const deadlineBlock = job.deadline ? (
    <div>
      <div className="flex items-center gap-4">
        <ClosingPostmark deadline={job.deadline} size="lg" waves />
        <div className="min-w-0 text-sm leading-snug">
          <p className="font-medium text-ink">{formatDate(job.deadline)}</p>
          {dl && !dl.urgent && /in \d/.test(dl.text) ? <p className="text-slate">{dl.text}</p> : null}
          <a href={`/api/calendar/${job.id}`} className="mt-1.5 inline-block font-medium text-accent underline underline-offset-2" rel="nofollow">Add to calendar</a>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate">
        Check the time zone in the posting: deadlines are often set in the duty station&apos;s or headquarters&apos; local time.
      </p>
    </div>
  ) : (
    <p className="text-sm text-slate">No closing date in our source. Check the employer&apos;s page.</p>
  );

  /** Where Apply goes, that applying is free, and (UN-system vacancies) the guide to reading one. */
  const applyNotes = (
    <>
      <p className="mt-3 text-sm leading-snug text-slate">
        {target.text}
        {target.host ? <span className="mt-0.5 block break-all text-xs text-slate">{target.host}</span> : null}
      </p>
      <p className="mt-2 text-sm leading-snug text-ink">Applying is free. {siteConfig.name} never charges a fee to apply.</p>
      {unSystem ? (
        <p className="mt-2 text-sm">
          <Link href="/guides/how-to-read-a-un-vacancy" className="font-medium text-accent underline-offset-2 hover:underline">How to read a UN vacancy</Link>
        </p>
      ) : null}
    </>
  );

  /** "Pay": no figures (they depend on grade, step and place), only where the official scales are. */
  const payLink = pay ? (
    pay.family === "UN" ? (
      <>UN salaries depend on grade and duty station — see the <a href={pay.href} className="text-accent underline" rel="noopener">ICSC scales</a></>
    ) : (
      <>EU salaries by grade — see the <a href={pay.href} className="text-accent underline" rel="noopener">EU pay page</a></>
    )
  ) : null;
  const orgLink = job.org_slug && otherAtOrg > 0 ? (
    <Link href={`/organizations/${job.org_slug}`} className="font-medium text-accent underline-offset-2 hover:underline">
      {otherAtOrg.toLocaleString("en-US")} other open {otherAtOrg === 1 ? "vacancy" : "vacancies"} at {orgRef ?? job.org_name}
    </Link>
  ) : null;

  // The known details, in one order for every layout. The closing date is not among them: it has its own box.
  const details = ([
    grade ? { label: "Grade", node: <>{grade} <Link href="/grades" className="text-sm text-accent underline">What grades mean</Link></> } : null,
    job.job_type ? { label: "Contract type", node: job.job_type } : null,
    experience ? { label: "Experience", node: experience } : null,
    job.languages?.length || job.desirable_languages?.length ? { label: "Languages besides English", node: <Languages job={job} /> } : null,
    whoCanApply && !description ? { label: "Who can apply", node: whoCanApply } : null,
    payLink ? { label: "Pay", node: payLink } : null,
    job.published_at ? { label: "Posted", node: formatDate(job.published_at) } : null,
    category && category.slug !== "other" ? { label: "Category", node: <Link href={`/categories/${category.slug}`} className="text-accent underline">{category.name}</Link> } : null,
    lang ? { label: "Posting language", node: lang.name } : null,
    job.reference ? { label: description ? "Reference" : "Reference number", node: <span className="break-all">{job.reference}</span> } : null,
  ] as (Detail | null)[]).filter((d): d is Detail => d !== null);
  // A page without a description and with three details or fewer: they go in the header, under the title, instead of a short list of their own.
  const thin = !description && details.length <= 3;
  const employerBlock = typePage || usually ? (
    <section aria-labelledby="employer-heading" className="mt-6">
      <h2 id="employer-heading" className="text-[1.15rem] font-semibold leading-tight text-ink">About {orgRef ?? job.org_name ?? "the employer"}</h2>
      <dl className="mt-2 space-y-2 text-[0.95rem]">
        {typePage ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate">Employer type</dt>
            <dd><Link href={typePage.path} className="text-accent underline">{typePage.label}</Link></dd>
          </div>
        ) : null}
        {usually ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate">Usually posts</dt>
            <dd className="text-ink">
              {usually.charAt(0).toUpperCase() + usually.slice(1)}
              <span className="block text-xs text-slate">From its listings of the past {Math.round(POSTING_MIX_DAYS / 30)} months</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  ) : null;

  return (
    <>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} /> : null}
      <TrackOnMount event={{ type: "job_view", jobId: job.id }} />

      <div className="brand-band">
        <div className="mx-auto max-w-6xl px-4 pb-8 pt-7 sm:px-6">
          <Breadcrumbs
            back={{ href: "/jobs", label: "Jobs" }}
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
              <h1 lang={lang?.code} className="text-[1.75rem] font-semibold leading-tight text-ink sm:text-[2.3rem]">{job.title}</h1>
              <p className="mt-2 text-lg text-ink">
                {job.org_slug ? <Link href={`/organizations/${job.org_slug}`} className="text-accent hover:underline">{job.org_name}</Link> : <span className="text-slate">Organization not in our source</span>}
              </p>
              {where !== NOT_SPECIFIED ? (
                <p className="mt-1 text-slate">
                  {/* Inline, so the published extra ("with frequent travel to the region") wraps as text on phones. */}
                  <Flag code={job.country_code} className="mr-1.5 align-[-0.1em] shadow-[0_0_0_1px_rgba(14,31,61,0.15)]" />
                  {where}
                  {publishedPlace ? <span className="text-sm"> ({publishedPlace})</span> : null}
                </p>
              ) : null}
              {thin && details.length ? (
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.95rem]">
                  {details.map((d) => (
                    <div key={d.label} className="flex flex-wrap gap-x-1.5">
                      <dt className="text-slate">{d.label}</dt>
                      <dd className="text-ink">{d.node}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {job.is_demo || job.is_remote ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {job.is_demo ? <Tag tone="demo">Demo data — not a real vacancy</Tag> : null}
                  {job.is_remote ? <Tag tone="remote">Remote / home-based</Tag> : null}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <SaveButton job={{ id: job.id, path: canonical, title: job.title, org: job.org_name }} />
                <ShareButton url={absoluteUrl(canonical)} title={job.title} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_21rem] lg:gap-12">
        <div className="min-w-0">
          {description ? (
            <section aria-labelledby="facts-heading">
              <h2 id="facts-heading" className="sr-only">Vacancy details</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-rule px-4 py-4 sm:grid-cols-3 sm:px-5">
                {job.deadline ? <Fact label="Closing date" className="lg:hidden">{formatDate(job.deadline)}</Fact> : null}
                {details.map((d) => <Fact key={d.label} label={d.label}>{d.node}</Fact>)}
              </dl>
              {whoCanApply ? (
                <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-[0.95rem] text-ink">
                  <span className="font-semibold">Who can apply:</span> {whoCanApply}{" "}
                  <Link href="/grades" className="text-accent underline">About grades and contract types</Link>
                </p>
              ) : null}
              {detailsLine}
            </section>
          ) : thin ? (
            <section aria-labelledby="facts-heading">
              <h2 id="facts-heading" className="sr-only">Vacancy details</h2>
              {detailsLine}
              {employerBlock}
            </section>
          ) : (
            <section aria-labelledby="facts-heading">
              <h2 id="facts-heading" className="text-[1.45rem] font-semibold leading-tight text-ink">At a glance</h2>
              <dl className="mt-3 divide-y divide-rule border-y border-rule">
                {job.deadline ? <GlanceRow label="Closing date" className="lg:hidden">{formatDate(job.deadline)}</GlanceRow> : null}
                {details.map((d) => <GlanceRow key={d.label} label={d.label}>{d.node}</GlanceRow>)}
              </dl>
              {detailsLine}
              {employerBlock}
            </section>
          )}

          {description ? (
            <section aria-labelledby="desc-heading" className="mt-8">
              <h2 id="desc-heading" className="text-[1.45rem] font-semibold leading-tight text-ink">About this vacancy</h2>
              {job.description_html ? (
                <div className="prose-job mt-4" dangerouslySetInnerHTML={{ __html: job.description_html }} />
              ) : (
                <>
                  <p className="mt-4 max-w-[68ch] text-[1.0625rem] leading-relaxed text-ink">{job.summary}</p>
                  <p className="mt-3 text-slate">The full description, requirements and application instructions are on the employer&apos;s own page.</p>
                </>
              )}
            </section>
          ) : null}

          <div className="mt-8 rounded-xl border border-rule p-4 lg:hidden">
            {deadlineBlock}
            <div className="mt-4 border-t border-rule pt-1 [&>p:first-child]:mt-3">{applyNotes}</div>
            <p className="mt-3 text-xs text-slate">Listing last updated from our source {formatDate(job.last_seen_at)}.</p>
          </div>

          <div className="sticky bottom-0 z-30 -mx-4 flex items-center gap-3 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
            {dl ? <p className={`shrink-0 text-sm ${dl.urgent ? "font-semibold text-signal" : "text-slate"}`}>{dl.text}</p> : null}
            <div className="min-w-0 flex-1">{applyButton}</div>
          </div>

          {isEuInstitution(job.org_type) ? <EpsoBook className="mt-10" source="job-page" /> : null}

          {/* Two small blocks: more in the category at other organizations, and a link to this organization's other vacancies. */}
          {more.length && category ? (
            <section className="mt-12" aria-labelledby="more-heading">
              <h2 id="more-heading" className="text-[1.45rem] font-semibold leading-tight text-ink">More in {category.name}</h2>
              <div className="mt-4"><JobList jobs={more} /></div>
            </section>
          ) : null}
          {orgLink ? <p className={`${more.length ? "mt-4" : "mt-10"} text-[0.95rem]`}>{orgLink}</p> : null}
        </div>

        <aside className="space-y-4">
          <div className="z-10 hidden rounded-xl border border-rule bg-paper p-5 lg:sticky lg:top-24 lg:block">
            <h2 className="sr-only">Closing date and how to apply</h2>
            {deadlineBlock}
            <div className="mt-4">{applyButton}</div>
            {applyNotes}
            <p className="mt-3 border-t border-rule pt-3 text-xs leading-relaxed text-slate">
              Listing last updated from our source {formatDate(job.last_seen_at)}.
            </p>
          </div>
          <p className="flex items-start gap-2 px-1 text-sm">
            <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v2.5L2.5 11h11L12 8.5V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            {siteConfig.freeWeeklyEmail ? (
              <Link href={alertHref} className="font-medium text-accent underline-offset-2 hover:underline">
                Get new {categoryPhrase(job.category)}vacancies in a free weekly email
              </Link>
            ) : (
              <TrackedLink href={alertHref} event="premium_cta_click" source="job-similar" className="font-medium text-accent underline-offset-2 hover:underline">
                Get new {categoryPhrase(job.category)}vacancies by email
              </TrackedLink>
            )}
          </p>
        </aside>
      </div>
    </>
  );
}
