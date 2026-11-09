import type { Metadata } from "next";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { siteConfig } from "@/lib/site";

const PATH = "/guides/how-to-read-a-un-vacancy";

const TITLE = "How to read a UN vacancy";
const DESCRIPTION =
  "What the parts of a UN or international organization vacancy usually mean: grade, contract type, duty station, closing date and time zone, who can apply, required and desirable qualifications, languages and how to apply.";

/**
 * Built at deploy without the database, so the header and footer list only the employer types that
 * always have vacancies; rendered again at most hourly after that, with the real counts (employerNav
 * in src/components/site-header.tsx).
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

/**
 * General, long-established conventions only (no salary figures, nothing that changes from year to year).
 * Each posting sets its own terms, and the page says so.
 */
const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "grade",
    title: "Grade",
    body: (
      <>
        <p>
          The grade gives the level of the post. P-1 to P-5 are professional posts, usually recruited internationally; D-1 and D-2 are director
          posts. National Officer (NO-A to NO-E) and General Service (G-1 to G-7) posts are usually recruited locally.
        </p>
        <p>
          The grade usually goes with a minimum number of years of experience, so it is a quick way to see whether a vacancy fits your career stage.{" "}
          <Link href="/grades" className="font-medium text-accent underline">Grades and contract types explained</Link>
        </p>
      </>
    ),
  },
  {
    id: "contract",
    title: "Contract type",
    body: (
      <>
        <p>
          A fixed-term appointment is a staff contract for a set period, often one or two years, that can be extended. A temporary appointment
          covers a shorter need. Both make you a staff member of the organization.
        </p>
        <p>
          Consultancies, service contracts (such as NPSA or IPSA) and internships are not staff appointments: the terms and benefits are
          different, and the posting or the contract says what they are.
        </p>
      </>
    ),
  },
  {
    id: "duty-station",
    title: "Duty station",
    body: (
      <>
        <p>
          The duty station is the city where the post is based. &ldquo;Home-based&rdquo; means you work from where you live, though the posting may
          still limit where that can be.
        </p>
        <p>
          Some field duty stations are classified as non-family, which means family members cannot live there with you. When it matters,
          the posting usually says so.
        </p>
      </>
    ),
  },
  {
    id: "closing-date",
    title: "Closing date and time zone",
    body: (
      <>
        <p>
          The closing date is the last day applications are accepted. Many postings also give a time and a time zone, which is often not
          your own: a deadline of midnight in New York or Geneva can fall the next morning in Asia.
        </p>
        <p>
          Application systems usually close automatically at the deadline, so it is safer to apply a day or two early. {siteConfig.name} shows
          the closing date when the employer publishes one; check the employer&apos;s page for the exact time.
        </p>
      </>
    ),
  },
  {
    id: "who-can-apply",
    title: "Who can apply",
    body: (
      <>
        <p>
          Read this part first. National Officer and General Service posts, and local service contracts, are usually open only to nationals
          or legal residents of the duty-station country. Some vacancies are open only to internal candidates, or to staff of the
          organization&apos;s own system.
        </p>
        <p>
          Many UN postings also say that applications from women, or from nationals of countries that are not or are under-represented in
          the organization, are encouraged. That is an encouragement, not a restriction.
        </p>
      </>
    ),
  },
  {
    id: "required-desirable",
    title: "Required and desirable",
    body: (
      <>
        <p>
          The requirements are usually split into education, work experience, languages and sometimes other skills. What is listed as
          required is the minimum: applications that don&apos;t meet it are normally screened out, often automatically.
        </p>
        <p>
          What is listed as desirable (or as an asset) is not needed to apply, but it helps you stand out. Many UN postings accept a
          first-level university degree with additional years of relevant experience in place of an advanced degree; the posting says when
          this applies.
        </p>
      </>
    ),
  },
  {
    id: "languages",
    title: "Languages",
    body: (
      <>
        <p>
          The UN has six official languages: Arabic, Chinese, English, French, Russian and Spanish. English and French are the working
          languages of the UN Secretariat, and many posts need one of them.
        </p>
        <p>
          Postings usually say which languages are required and which are desirable. Language skills may be tested during the selection, so
          state your level honestly.
        </p>
      </>
    ),
  },
  {
    id: "how-to-apply",
    title: "How to apply",
    body: (
      <>
        <p>
          Each organization uses its own application system. You usually create a profile and fill in your work history there (some
          organizations use a personal history form, often called a P11), and add a cover letter or answer screening questions.
        </p>
        <p>
          Note the vacancy&apos;s reference number: it identifies the post if you contact the organization. Real UN and international
          organizations do not charge a fee at any stage of recruitment; a request for money is a sign of fraud.
        </p>
      </>
    ),
  },
];

export default function HowToReadAVacancyPage() {
  return (
    <>
      <PageHeader
        width="max-w-3xl"
        title="How to read a UN vacancy"
        crumbs={[{ href: "/", label: "Home" }, { href: PATH, label: "How to read a UN vacancy" }]}
        intro="What the parts of a vacancy at the UN or another international organization usually mean. These are general conventions; each posting sets its own terms, so the posting always decides."
      />
      <div className="mx-auto max-w-3xl px-4 py-10 text-[1.05rem] leading-relaxed text-ink sm:px-6">
        <nav aria-label="On this page" className="rounded-xl border border-rule p-5 text-[0.95rem]">
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="text-accent hover:underline">{s.title}</a></li>
            ))}
          </ul>
        </nav>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-24 space-y-3">
            <h2 id={`${s.id}-h`} className="text-2xl font-semibold leading-tight">{s.title}</h2>
            {s.body}
          </section>
        ))}
        <section aria-labelledby="next-h" className="mt-12 rounded-xl border border-rule bg-mist p-5">
          <h2 id="next-h" className="text-xl font-semibold">Next steps</h2>
          <ul className="mt-2 space-y-1.5">
            <li><Link href="/jobs" className="font-medium text-accent underline">Browse open vacancies</Link></li>
            <li><Link href="/jobs?hidelocal=1" className="font-medium text-accent underline">Browse vacancies without local-only posts</Link></li>
            <li><Link href="/grades" className="font-medium text-accent underline">Grades and contract types explained</Link></li>
          </ul>
        </section>
      </div>
    </>
  );
}
