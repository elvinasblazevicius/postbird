import type { Metadata } from "next";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PAY_SOURCES } from "@/lib/grades";

const TITLE = "UN and international job grades explained";
const DESCRIPTION = "A plain-English guide to P, D, G and NO grades, service contracts, consultancies, internships, UN Volunteers and EU staff categories.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/grades" },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

/** Official pay sources, linked (no figures): see PAY_SOURCES in src/lib/grades.ts. */
const { icscSalaryScales: ICSC_SALARY_SCALES, icscPostAdjustment: ICSC_POST_ADJUSTMENT, euSalaries: EU_SALARIES, euStaffRegulations: EU_STAFF_REGULATIONS } = PAY_SOURCES;

function Pay({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.95rem] text-slate"><span className="font-medium text-ink">Pay:</span> {children}</p>;
}

const ext = { className: "text-accent underline", rel: "noopener" } as const;

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "professional",
    title: "Professional (P-1 to P-5)",
    body: (
      <>
        <p>
          Professional posts are usually recruited internationally. P-1 and P-2 are entry level, P-3 is mid-career, and P-4 and P-5 are senior
          posts that often lead a team or a programme.
        </p>
        <p>
          In the UN Secretariat the usual minimum, with an advanced university degree, is 2 years of relevant experience for P-2, 5 for P-3, 7 for
          P-4 and 10 for P-5. Other organizations set their own requirements, so the posting decides.
        </p>
        <Pay>
          one salary scale across the UN common system, plus a post adjustment that depends on the duty station. See the{" "}
          <a href={ICSC_SALARY_SCALES} {...ext}>ICSC salary scales</a> and <a href={ICSC_POST_ADJUSTMENT} {...ext}>post adjustment</a>.
        </Pay>
      </>
    ),
  },
  {
    id: "director",
    title: "Director (D-1, D-2) and senior appointments",
    body: (
      <>
        <p>
          D-1 and D-2 are director-level posts that head large offices, divisions or programmes. Assistant Secretary-General (ASG) and
          Under-Secretary-General (USG) are senior leadership appointments.
        </p>
        <Pay>
          the same scale and post adjustment as Professional posts: the <a href={ICSC_SALARY_SCALES} {...ext}>ICSC salary scales</a>.
        </Pay>
      </>
    ),
  },
  {
    id: "national-officers",
    title: "National Officer (NO-A to NO-E)",
    body: (
      <>
        <p>
          Professional-level posts in country offices, filled by nationals of the country where the post is located. NO-A is the entry level and
          NO-E the most senior.
        </p>
        <Pay>a local salary scale for each duty station, linked from the <a href={ICSC_SALARY_SCALES} {...ext}>ICSC salary scales</a> page.</Pay>
      </>
    ),
  },
  {
    id: "general-service",
    title: "General Service (G-1 to G-7)",
    body: (
      <>
        <p>
          Administrative, technical and support posts. They are normally recruited locally, from nationals or legal residents of the country (or
          commuting area) of the duty station.
        </p>
        <Pay>a local salary scale for each duty station, linked from the <a href={ICSC_SALARY_SCALES} {...ext}>ICSC salary scales</a> page.</Pay>
      </>
    ),
  },
  {
    id: "field-service",
    title: "Field Service (FS)",
    body: <p>Internationally recruited staff in UN field missions, mostly in administration, logistics and technical roles.</p>,
  },
  {
    id: "service-contracts",
    title: "Service contracts (NPSA, IPSA, LICA, SB, SC)",
    body: (
      <p>
        Contracts for non-staff personnel, used by UNDP, UNOPS and other agencies. NPSA (National Personnel Service Agreement), LICA (Local
        Individual Contractor Agreement) and service contracts (SB, SC) are for local recruitment. IPSA (International Personnel Service
        Agreement) is international.
      </p>
    ),
  },
  {
    id: "consultancies",
    title: "Consultancies",
    body: (
      <p>
        A contract for a defined piece of work over a set period, paid as fees. Consultants are not staff members, and the contract usually does
        not include staff benefits. The posting gives the terms.
      </p>
    ),
  },
  {
    id: "internships",
    title: "Internships",
    body: (
      <p>
        For students and recent graduates, usually for a few months. Whether an internship is paid, and how, differs between organizations; the
        posting says what applies.
      </p>
    ),
  },
  {
    id: "unv",
    title: "UN Volunteers (UNV)",
    body: (
      <p>
        UN Volunteers serve with UN entities through the UN Volunteers programme, as national or international volunteers. They receive a
        volunteer living allowance rather than a salary.
      </p>
    ),
  },
  {
    id: "eu",
    title: "EU institutions: AD, AST and contract agents",
    body: (
      <>
        <p>
          Permanent EU officials are Administrators (AD, starting at AD 5 for graduates) or Assistants (AST). Secretaries and clerks are AST/SC.
          Most permanent posts are filled through open competitions run by EPSO, the EU&apos;s recruitment office.
        </p>
        <p>
          Contract agents (function groups I to IV) and temporary agents are hired for limited periods, usually through separate selection
          procedures.
        </p>
        <Pay>
          set by the <a href={EU_STAFF_REGULATIONS} {...ext}>EU Staff Regulations</a>. EU Careers publishes the{" "}
          <a href={EU_SALARIES} {...ext}>salary tables for AD, AST, AST/SC and contract staff</a>.
        </Pay>
      </>
    ),
  },
];

export default function GradesPage() {
  return (
    <>
      <PageHeader width="max-w-3xl"
        title="Grades and contract types explained"
        crumbs={[{ href: "/", label: "Home" }, { href: "/grades", label: "Grades explained" }]}
        intro="What the letters and numbers in international vacancies usually mean. These are general descriptions; each posting sets its own requirements."
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
        <section aria-labelledby="local-h" className="mt-12 rounded-xl border border-rule bg-mist p-5">
          <h2 id="local-h" className="text-xl font-semibold">Posts open only to nationals or residents</h2>
          <p className="mt-2">
            National Officer, General Service, NPSA, LICA and service contract (SB, SC) posts are usually open only to nationals or legal residents
            of the duty-station country. Job pages say so where the grade is given, and the jobs list can hide these posts.
          </p>
          <p className="mt-3">
            <Link href="/jobs?hidelocal=1" className="font-medium text-accent underline">Browse jobs without local-only posts</Link>
          </p>
        </section>
      </div>
    </>
  );
}
