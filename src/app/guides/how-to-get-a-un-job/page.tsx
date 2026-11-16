import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";
import { siteConfig } from "@/lib/site";

const PATH = "/guides/how-to-get-a-un-job";
const TITLE = "How to get a UN job: every route in, explained";
const DESCRIPTION =
  "The main ways into the UN and other international organizations: regular vacancies, internships, the Young Professionals Programme, JPO posts, UN Volunteers, consultancies and EU routes, with who each suits.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

/** The routes in, each with who it suits and where to read more. */
const ROUTES: { name: string; suits: string; href: string; more: string }[] = [
  { name: "Internships", suits: "Students and recent graduates. Some agencies pay a stipend, others nothing.", href: "/guides/un-internships", more: "Which UN internships are paid" },
  { name: "Young Professionals Programme (YPP)", suits: "Graduates aged 32 or under from the countries taking part that year. Leads to P-1 and P-2 posts.", href: "/guides/un-young-professionals-programme", more: "How the YPP works" },
  { name: "Junior Professional Officer (JPO)", suits: "Young professionals, usually with a Master's and at least two years' experience, sponsored by their own or another government.", href: "/guides/jpo-programme", more: "Which countries sponsor JPOs" },
  { name: "UN Volunteers", suits: "Anyone with the experience an assignment asks for; youth and university assignments for younger people.", href: "/guides/un-volunteers", more: "How UN Volunteers works" },
  { name: "Regular vacancies", suits: "Everyone who meets a post's requirements: Professional posts (P), and local posts (NO, G) for nationals and residents.", href: "/jobs", more: "Browse open vacancies" },
  { name: "Consultancies", suits: "People with specialist skills; short contracts paid by fee rather than salary.", href: "/jobs?type=Consultancy", more: "Open consultancies" },
  { name: "EU institutions", suits: "EU nationals mostly: EPSO competitions for permanent posts, and the Blue Book traineeship for graduates.", href: "/guides/epso-exams", more: "How EPSO exams work" },
];

function Routes() {
  return (
    <div className="rounded-xl border-2 border-brand bg-paper p-5">
      <h2 className="text-xl font-semibold">Routes in, and who each suits</h2>
      <ul className="mt-3 divide-y divide-rule">
        {ROUTES.map((r) => (
          <li key={r.name} className="py-3">
            <p className="font-semibold">{r.name}</p>
            <p className="mt-0.5 text-[0.95rem] text-tint-ink">{r.suits}</p>
            <Link href={r.href} className="mt-1 inline-block text-[0.95rem] font-medium text-accent underline">{r.more}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HowToGetAUnJob() {
  return (
    <GuideLayout
      path={PATH}
      title="How to get a UN job"
      crumb="How to get a UN job"
      description={DESCRIPTION}
      intro="There is no single entry exam for the UN system. Each organization recruits for itself, and there are several routes in, depending on your age, nationality, education and experience."
      before={<Routes />}
      sections={[
        {
          id: "read",
          title: "Read every vacancy closely",
          body: (
            <p>
              Each posting sets its own grade, requirements and closing date, and applications that don&apos;t meet the minimum requirements are
              usually screened out. <Link href="/guides/how-to-read-a-un-vacancy">How to read a UN vacancy</Link> explains each part, and{" "}
              <Link href="/grades">grades explained</Link> what P, NO and G mean.
            </p>
          ),
        },
        {
          id: "apply",
          title: "Applying",
          body: (
            <ul>
              <li>Each organization has its own application system. The UN Secretariat publishes all its vacancies on the UN Careers portal, which sends you to the right system to apply; other organizations use their own portals.</li>
              <li>Answer the competencies the vacancy lists, with concrete examples, in your cover letter or the screening questions.</li>
              <li>State your languages honestly: they may be tested.</li>
              <li>Apply before the closing date in the organization&apos;s time zone. New vacancies can close within a week or two, so <Link href="/alerts">job alerts</Link> help you see them in time.</li>
            </ul>
          ),
        },
        {
          id: "fraud",
          title: "Watch out for fraud",
          body: (
            <p>
              The UN states that it does not charge a fee at any stage of its recruitment process, and{" "}
              {siteConfig.name} never charges a fee to apply. A request for money, whether for visas, &ldquo;processing&rdquo; or training, is a
              common sign of a recruitment scam.
            </p>
          ),
        },
        {
          id: "pay",
          title: "What the jobs pay",
          body: (
            <p>
              Professional staff pay depends on grade and duty station: try the <Link href="/guides/un-salaries">UN salary calculator</Link>.
            </p>
          ),
        },
      ]}
      vacancies={[
        { label: "All open vacancies", href: "/jobs" },
        { label: "Entry-level posts (P-1, P-2, NO-A)", href: "/jobs?grade=entry" },
        { label: "Internships", href: "/jobs?type=Internship" },
      ]}
      sources={[
        { label: "UN Careers", href: "https://careers.un.org/" },
        { label: "UN HR portal: where UN Secretariat vacancies are published", href: "https://hr.un.org/node/3140" },
        { label: "UN internship fact sheet", href: "https://www.un.org/sites/un2.un.org/files/2021/07/internship_quick_guide_fact_sheet.pdf" },
        { label: "UN JPO Programme: how to apply (UN DESA)", href: "https://jpo.desa.un.org/node/3290" },
      ]}
    />
  );
}
