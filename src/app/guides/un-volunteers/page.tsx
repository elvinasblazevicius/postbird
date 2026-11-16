import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";

const PATH = "/guides/un-volunteers";
const TITLE = "UN Volunteers: types of assignments, allowances and how to apply";
const DESCRIPTION =
  "How to become a UN Volunteer: international, youth, university and national assignments, how long they last, the living allowance, and how to apply through the Unified Volunteering Platform.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

const ABROAD = "https://unv.org/become-volunteer/volunteer-abroad";
const HOME = "https://www.unv.org/become-volunteer/volunteer-your-country";

export default function UnVolunteersGuide() {
  return (
    <GuideLayout
      path={PATH}
      title="UN Volunteers"
      crumb="UN Volunteers"
      description={DESCRIPTION}
      intro="The UN Volunteers programme (UNV) places volunteers with UN organizations around the world. It is a common way into UN work, and volunteers receive an allowance to live on."
      sections={[
        {
          id: "types",
          title: "Types of assignments",
          body: (
            <ul>
              <li><strong>International UN Volunteers</strong> serve outside their own country, generally for 3 to 12 months, and can be extended up to four years in total.</li>
              <li><strong>UN Youth Volunteers</strong> serve from six months to two years.</li>
              <li><strong>UN University Volunteers</strong> serve three to six months.</li>
              <li><strong>National UN Volunteers</strong> serve in their own country. Refugees and stateless people legally living in a country may be eligible there, where national law allows.</li>
            </ul>
          ),
        },
        {
          id: "requirements",
          title: "Requirements",
          body: (
            <p>
              Each assignment sets its own requirements for professional and academic experience and languages. Age and experience rules for
              each category are in UNV&apos;s conditions of service. Volunteers come from more than 180 nationalities.
            </p>
          ),
        },
        {
          id: "allowance",
          title: "The living allowance",
          body: (
            <>
              <p>
                UN Volunteers are not paid a salary. International volunteers receive allowances so they can keep a secure standard of living
                during the assignment; national volunteers receive a volunteer living allowance that varies with local living costs and by
                category.
              </p>
              <p>
                UNV is clear that the allowances are not a salary or a reward for the work. For comparison with staff pay, see{" "}
                <Link href="/guides/un-salaries">UN salaries</Link>.
              </p>
            </>
          ),
        },
        {
          id: "apply",
          title: "How to apply",
          body: (
            <ol className="list-decimal space-y-1.5">
              <li>Create a profile on UNV&apos;s Unified Volunteering Platform.</li>
              <li>Register in the Global Talent Pool: you need to before you can apply for any assignment.</li>
              <li>Apply for the assignments you match. Log in at least once a year to keep your profile active.</li>
            </ol>
          ),
        },
      ]}
      vacancies={[
        { label: "Open UN Volunteer and volunteer positions", href: "/jobs?type=Volunteer" },
        { label: "Internships", href: "/jobs?type=Internship" },
      ]}
      sources={[
        { label: "UNV: volunteer abroad", href: ABROAD },
        { label: "UNV: volunteer in your country", href: HOME },
      ]}
    />
  );
}
