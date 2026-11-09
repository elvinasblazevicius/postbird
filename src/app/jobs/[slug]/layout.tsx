import Link from "next/link";
import { ClosedJobProvider } from "@/components/closed-job";
import { JobList } from "@/components/job-card";
import { Breadcrumbs } from "@/components/page-header";
import { similarJobs, type JobDetail } from "@/lib/jobs";
import { categoryName, formatDate } from "@/lib/site";
import { isJobOpen, loadJob } from "./job-data";

type Props = { params: Promise<{ slug: string }>; children: React.ReactNode };

/**
 * Closed vacancies answer with a 404 (the page calls notFound()). This layout
 * prepares what that 404 shows instead of the plain message: that the
 * vacancy has closed, and up to 6 open vacancies at the same organization or
 * in the same category.
 */
export default async function JobLayout({ params, children }: Props) {
  const job = await loadJob((await params).slug);
  if (!job || isJobOpen(job)) return children;
  const similar = await similarJobs(job, 6);
  return <ClosedJobProvider notice={<ClosedVacancy job={job} similar={similar} />}>{children}</ClosedJobProvider>;
}

function similarLine(org: string | null, category: string | null): string {
  const s = [org ? `at ${org}` : null, category ? `in ${category}` : null].filter(Boolean).join(" or ");
  return s ? `Open now ${s}.` : "";
}

function ClosedVacancy({ job, similar }: { job: JobDetail; similar: Awaited<ReturnType<typeof similarJobs>> }) {
  const category = job.category !== "other" ? categoryName(job.category) : null;
  return (
    <>
      <div className="brand-band">
        <div className="mx-auto max-w-6xl px-4 pb-9 pt-7 sm:px-6">
          <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/jobs", label: "Jobs" }]} />
          <h1 className="mt-4 text-[1.9rem] font-semibold leading-tight text-ink sm:text-[2.4rem]">This vacancy has closed</h1>
          <p className="mt-3 max-w-3xl text-[1.05rem] leading-relaxed text-slate">
            {job.title}
            {job.org_name ? `, ${job.org_name}` : ""}.{" "}
            {job.deadline && job.deadline < new Date().toISOString().slice(0, 10)
              ? `Applications closed on ${formatDate(job.deadline)}.`
              : "It is no longer listed."}
          </p>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {similar.length ? (
          <section aria-labelledby="similar-heading">
            <h2 id="similar-heading" className="text-[1.45rem] font-semibold leading-tight text-ink">Similar open vacancies</h2>
            <p className="mt-1 text-slate">{similarLine(job.org_name, category)}</p>
            <div className="mt-5"><JobList jobs={similar} headingLevel={3} /></div>
          </section>
        ) : (
          <p className="text-slate">There are no similar open vacancies right now.</p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          {category ? (
            <Link href={`/categories/${job.category}`} className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-accent">See open {category} jobs</Link>
          ) : null}
          <Link href="/jobs" className="rounded-lg border border-rule px-4 py-2.5 font-medium text-ink hover:bg-mist">All open vacancies</Link>
        </div>
      </div>
    </>
  );
}
