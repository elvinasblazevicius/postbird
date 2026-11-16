import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";

const PATH = "/guides/eu-blue-book-traineeship";
const TITLE = "EU Blue Book traineeship: eligibility, grant and how to apply";
const DESCRIPTION =
  "The European Commission's paid Blue Book traineeship: five months, about 1,000 places per session, the monthly grant, degree and language requirements, application windows and the selection steps.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

const ESSENTIALS = "https://traineeships.ec.europa.eu/about/programme-essentials_en";
const ELIGIBILITY = "https://traineeships.ec.europa.eu/who-can-apply/eligibiliy-criteria_en";
const PROCESS = "https://traineeships.ec.europa.eu/how-apply/process-overview_en";
const EU_CAREERS = "https://eu-careers.europa.eu/en/node/15983";

export default function BlueBookGuide() {
  return (
    <GuideLayout
      path={PATH}
      title="EU Blue Book traineeship"
      crumb="Blue Book traineeship"
      description={DESCRIPTION}
      intro="The European Commission's traineeship programme, known as the Blue Book, offers paid five-month traineeships twice a year, mostly to graduates from EU countries."
      sections={[
        {
          id: "what",
          title: "What it is",
          body: (
            <>
              <p>
                There are two sessions a year, starting in March and October, with around 1,000 places per session. There are three types: an
                administrative traineeship for university graduates, an administrative traineeship for graduates of vocational education and
                training, and a translation traineeship.
              </p>
              <p>
                Trainees receive a monthly grant: the EU Careers site gives €1,376.89 a month, adjusted each session, with an increase of up to
                50% for trainees with a disability. Check the current amount on the traineeships site.
              </p>
            </>
          ),
        },
        {
          id: "eligibility",
          title: "Who can apply (administrative traineeship for graduates)",
          body: (
            <ul>
              <li>A completed university degree of at least three years (180 ECTS credits or equivalent), awarded by the application deadline.</li>
              <li>EU nationals: very good English, French or German (C1 or above, or mother tongue), plus at least B2 in a second EU language.</li>
              <li>Non-EU nationals: C1 or above in English, French or German. Places for non-EU nationals are limited and open to nationals of candidate countries with a pre-accession strategy.</li>
              <li>No more than six weeks (42 days) of previous work or traineeship in any EU institution, body or agency.</li>
              <li>18 or older when the traineeship starts.</li>
            </ul>
          ),
        },
        {
          id: "when",
          title: "When to apply",
          body: (
            <ul>
              <li>For the <strong>March</strong> session: applications open in July and August of the previous year.</li>
              <li>For the <strong>October</strong> session: applications open in February.</li>
            </ul>
          ),
        },
        {
          id: "selection",
          title: "How selection works",
          body: (
            <ol className="list-decimal space-y-1.5">
              <li>Applications are scored on academic background, language skills and other skills and experience; for EU candidates, national guiding rates apply.</li>
              <li>Pre-selected candidates enter the <strong>Virtual Blue Book</strong>, the database Commission services recruit from.</li>
              <li>From the Virtual Blue Book you can apply for up to three positions; services may interview you. There are about three candidates for each place.</li>
              <li>An offer is final only when it appears in your account. Each application is valid for one session.</li>
            </ol>
          ),
        },
        {
          id: "next",
          title: "After the traineeship",
          body: (
            <p>
              A traineeship doesn&apos;t lead to a post by itself. Permanent EU posts are filled through EPSO competitions: see{" "}
              <Link href="/guides/epso-exams">how EPSO exams work</Link>.
            </p>
          ),
        },
      ]}
      vacancies={[
        { label: "EU institution vacancies", href: "/eu-jobs" },
        { label: "Traineeships", href: "/jobs?type=Traineeship" },
      ]}
      sources={[
        { label: "European Commission traineeships: programme essentials", href: ESSENTIALS },
        { label: "European Commission traineeships: eligibility criteria", href: ELIGIBILITY },
        { label: "European Commission traineeships: application process", href: PROCESS },
        { label: "EU Careers: Blue Book traineeships", href: EU_CAREERS },
      ]}
    />
  );
}
