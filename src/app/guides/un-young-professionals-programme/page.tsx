import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";

const PATH = "/guides/un-young-professionals-programme";
const TITLE = "UN Young Professionals Programme (YPP): eligibility, exam and timeline";
const DESCRIPTION =
  "How the UN Young Professionals Programme works: the age limit (32), participating countries, degree and language requirements, the exam, the reserve list and P-1/P-2 appointments.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

const AI = "https://policy.un.org/sites/policy.un.org/files/files/documents/2022/Apr/ai_2012_-_2_rev.1_young_professionals_programme.consolidated.pdf";
const BROCHURE = "https://hr.un.org/sites/hr.un.org/files/2023%20YPP%20Brochure%20-%20English.pdf";

export default function YppGuide() {
  return (
    <GuideLayout
      path={PATH}
      title="UN Young Professionals Programme (YPP)"
      crumb="Young Professionals Programme"
      description={DESCRIPTION}
      intro="The YPP is the UN Secretariat's entrance exam for young graduates from the countries invited to take part each year. Passing it puts you on a list for P-1 and P-2 posts."
      sections={[
        {
          id: "who",
          title: "Who can apply",
          body: (
            <ul>
              <li>A national of a country taking part in that year&apos;s exam. The list changes every year and is published with the call for applications.</li>
              <li>32 or younger on 31 December of the exam year.</li>
              <li>At least a Bachelor&apos;s degree (or a three-year equivalent) relevant to the exam subject.</li>
              <li>Fluent in English or French.</li>
            </ul>
          ),
        },
        {
          id: "experience",
          title: "Do you need work experience?",
          body: (
            <p>
              No. Work experience is not required. In the 2023 cycle it was used only to choose between candidates when more than 60 people
              from the same country applied for the same subject.
            </p>
          ),
        },
        {
          id: "timeline",
          title: "Timeline and exam",
          body: (
            <>
              <p>
                The call opens on the UN Careers portal and the timing varies each year; in the 2023 cycle applications ran from April to June,
                screening in July and August, the exam and assessment from September to February, and interviews and results from March to May.
              </p>
              <p>The exam is held online, in a subject area announced with the call (for example, economic affairs, or information systems and technology).</p>
            </>
          ),
        },
        {
          id: "after",
          title: "If you pass",
          body: (
            <p>
              Successful candidates go on a reserve list, valid for three years, and are considered for posts at the P-1 or P-2 level across
              the UN Secretariat. The UN does not charge any fee at any stage. Not eligible this year? See the other routes in{" "}
              <Link href="/guides/how-to-get-a-un-job">how to get a UN job</Link>.
            </p>
          ),
        },
        {
          id: "staff",
          title: "For current General Service staff",
          body: (
            <p>
              A separate stream lets UN Secretariat staff in the General Service and related categories, with at least five years of continuous
              service, sit the exam to move to the Professional category.
            </p>
          ),
        },
      ]}
      vacancies={[
        { label: "Entry-level posts (P-1, P-2, NO-A)", href: "/jobs?grade=entry" },
        { label: "Young professional and graduate programmes", href: "/jobs?q=young%20professional" },
      ]}
      sources={[
        { label: "UN administrative instruction ST/AI/2012/2/Rev.1: Young Professionals Programme (consolidated)", href: AI },
        { label: "UN Young Professionals Programme brochure (2023)", href: BROCHURE },
      ]}
    />
  );
}
