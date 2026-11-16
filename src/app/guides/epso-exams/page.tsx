import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";
import { EpsoBook } from "@/components/epso-book";

const PATH = "/guides/epso-exams";
const TITLE = "EPSO exams explained: how EU recruitment competitions work";
const DESCRIPTION =
  "How EPSO competitions for permanent EU posts work: the notice, application, reasoning tests (pass/fail), EU knowledge or field tests, the case study, the reserve list, and AD5, AD6 and AST entry grades.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

const MODEL = "https://eu-careers.europa.eu/en/competition-model-permanent-officials";

export default function EpsoGuide() {
  return (
    <GuideLayout
      path={PATH}
      title="EPSO exams explained"
      crumb="EPSO exams"
      description={DESCRIPTION}
      intro="Permanent posts in the EU institutions are filled through competitions run by the European Personnel Selection Office (EPSO). Here is how a competition works, from the notice to the reserve list."
      sections={[
        {
          id: "types",
          title: "Generalist and specialist competitions",
          body: (
            <ul>
              <li><strong>Generalist</strong> competitions are open to graduates of any field, with no experience required. Successful candidates are recruited as administrators at grade AD5.</li>
              <li><strong>Specialist</strong> competitions are open to graduates and non-graduates, usually with experience in the field. Successful candidates start as administrators from AD6, or as assistants from AST3 or higher.</li>
            </ul>
          ),
        },
        {
          id: "stages",
          title: "The stages of a competition",
          body: (
            <ol className="list-decimal space-y-1.5">
              <li><strong>Notice of competition</strong>: the job profile, duties, eligibility rules and selection procedure.</li>
              <li><strong>Self-assessment (optional)</strong>: EPSO&apos;s EASI tool gives you private feedback on whether you are likely to be eligible.</li>
              <li><strong>Application</strong> through your EPSO account.</li>
              <li><strong>Tests</strong>: reasoning tests on a pass/fail basis; an EU knowledge test (generalists) or a field-related multiple-choice test (specialists), which ranks candidates; a digital skills test where it applies; and a written case study, marked only for the candidates with the best results in the EU knowledge or field test.</li>
              <li><strong>Eligibility checks</strong> before the reserve list.</li>
              <li><strong>Reserve list</strong>: the institutions recruit from it as posts open.</li>
            </ol>
          ),
        },
        {
          id: "reasoning",
          title: "The reasoning tests",
          body: (
            <p>
              In competitions for permanent posts the reasoning tests are pass/fail: they don&apos;t rank you, but failing them ends your
              competition. EPSO&apos;s reasoning tests are multiple-choice tests of verbal, numerical and abstract reasoning (EPSO describes
              these three for its contract staff selections, with sample tests). They are timed, so practising under time pressure helps.
            </p>
          ),
        },
        {
          id: "timing",
          title: "How long it takes",
          body: (
            <p>
              A competition takes from a few months to several months, depending on the competition. EPSO no longer uses oral tests in its
              selection procedures. Results can be challenged once, through a single request-for-review procedure, for a material error or a
              breach of the rules.
            </p>
          ),
        },
        {
          id: "other-routes",
          title: "Other ways into the EU institutions",
          body: (
            <p>
              Contract and temporary staff are selected through separate procedures, and EU agencies also recruit directly; their vacancies
              are on <Link href="/eu-jobs">EU institution jobs</Link>. For graduates, the{" "}
              <Link href="/guides/eu-blue-book-traineeship">Blue Book traineeship</Link> is a common first step.
            </p>
          ),
        },
      ]}
      before={<EpsoBook source="guide-epso" />}
      vacancies={[
        { label: "EU institution vacancies", href: "/eu-jobs" },
        { label: "EU AD grade posts", href: "/jobs?grade=AD" },
        { label: "EU contract agent posts (FG I to FG IV)", href: "/jobs?grade=FG" },
      ]}
      sources={[
        { label: "EU Careers (EPSO): competition model for permanent officials", href: MODEL },
        { label: "EPSO: tests used in selection procedures", href: "https://selection.eu-careers.europa.eu/mt/selection-procedure/epso-tests" },
      ]}
    />
  );
}
