import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { PageHeader } from "@/components/page-header";
import { EpsoBook } from "@/components/epso-book";
import { INDEPENDENCE_NOTE } from "@/lib/site";

const PATH = "/resources";
const TITLE = "Resources for international job seekers";
const DESCRIPTION =
  "Free guides for UN, NGO and EU job seekers: how to get a UN job, a UN salary calculator, which UN internships are paid, JPO sponsors, the YPP, UN Volunteers, EPSO exams and the Blue Book traineeship.";

/** Rendered again at most hourly, like the guides (the header and footer list employer types with live counts). */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

/** The site's guides, each with what it answers. New guides are added here and in the sitemap. */
const GUIDES: { href: string; title: string; text: string }[] = [
  {
    href: "/guides/how-to-read-a-un-vacancy",
    title: "How to read a UN vacancy",
    text: "What each part of a vacancy usually means: grade, contract type, duty station, closing date and time zone, who can apply, qualifications, languages and how to apply.",
  },
  {
    href: "/grades",
    title: "Grades and contract types explained",
    text: "P, D, G and NO grades, service contracts, consultancies, internships, UN Volunteers and EU staff categories, with links to the official pay scales.",
  },
  {
    href: "/guides/how-to-get-a-un-job",
    title: "How to get a UN job",
    text: "Every route in, and who each suits: regular vacancies, internships, the Young Professionals Programme, JPO posts, UN Volunteers, consultancies and the EU institutions.",
  },
  {
    href: "/guides/un-salaries",
    title: "UN salaries and salary calculator",
    text: "Work out Professional pay by grade and duty station from the official ICSC scales: net base salary, post adjustment, and what else is paid on top.",
  },
  {
    href: "/guides/un-internships",
    title: "Which UN internships are paid",
    text: "Agency by agency, which internships pay a stipend and which don't, with links to each organization's own rules.",
  },
  {
    href: "/guides/jpo-programme",
    title: "Junior Professional Officer (JPO) programme",
    text: "Which countries sponsor JPOs, who can apply, and where each country's programme is announced.",
  },
  {
    href: "/guides/un-young-professionals-programme",
    title: "UN Young Professionals Programme (YPP)",
    text: "The age limit, participating countries, the exam, the reserve list and P-1/P-2 appointments.",
  },
  {
    href: "/guides/un-volunteers",
    title: "UN Volunteers",
    text: "International, youth, university and national assignments, the living allowance, and how to apply.",
  },
  {
    href: "/guides/epso-exams",
    title: "EPSO exams explained",
    text: "How EU competitions for permanent posts work, from the notice and reasoning tests to the case study and reserve list.",
  },
  {
    href: "/guides/eu-blue-book-traineeship",
    title: "EU Blue Book traineeship",
    text: "The European Commission's paid five-month traineeship: eligibility, the monthly grant, application windows and selection.",
  },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        width="max-w-3xl"
        title="Resources"
        crumbs={[{ href: "/", label: "Home" }, { href: PATH, label: "Resources" }]}
        intro="Guides to understanding international vacancies, and help preparing for selection tests."
        note={INDEPENDENCE_NOTE}
      />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <section aria-labelledby="guides-heading">
          <h2 id="guides-heading" className="text-[1.4rem] font-semibold leading-tight text-ink">Guides</h2>
          <ul className="mt-4 grid gap-3">
            {GUIDES.map((g) => (
              <li key={g.href}>
                <Link href={g.href} className="group block rounded-xl border border-rule bg-paper p-4 no-underline hover:border-sky-rule sm:p-5">
                  <span className="text-[1.1rem] font-bold text-ink group-hover:text-accent group-hover:underline">{g.title}</span>
                  <span className="mt-1 block text-[0.95rem] leading-relaxed text-tint-ink">{g.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="tests-heading" className="mt-10">
          <h2 id="tests-heading" className="text-[1.4rem] font-semibold leading-tight text-ink">Selection test preparation</h2>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-tint-ink">
            EU institutions recruit permanent officials, and many contract staff, through EPSO selection procedures, which usually include
            verbal, numerical and abstract reasoning tests.
          </p>
          <EpsoBook className="mt-4" source="resources" />
        </section>
      </div>
    </>
  );
}
