import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";

const PATH = "/guides/jpo-programme";
const TITLE = "Junior Professional Officer (JPO) programme: which countries sponsor, who can apply";
const DESCRIPTION =
  "The UN Junior Professional Officer programme explained: the 41 countries with JPO agreements with the UN, the four that also sponsor developing-country nationals, eligibility and how to apply through your government.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

const DESA_FACT_SHEET = "https://jpo.desa.un.org/sites/default/files/jpofiles/UN%20JPO%20Programme%20-%20Fact%20sheet%20February%202024.pdf";
const DESA_HOW_TO_APPLY = "https://jpo.desa.un.org/node/3290";

/** Donor countries named in the UN DESA JPO fact sheet (February 2024), as written there. */
const DONORS = [
  "Australia", "Austria", "Bahrain", "Belgium", "Canada", "China", "Denmark", "DPRK", "Egypt", "Estonia", "Finland", "France", "Germany",
  "Hungary", "Iceland", "Italy", "Israel", "Japan", "Kazakhstan", "Kuwait", "Liechtenstein", "Luxembourg", "Mongolia", "Morocco",
  "Netherlands", "New Zealand", "Norway", "Poland", "Qatar", "Russian Federation", "Saudi Arabia", "Singapore", "South Africa",
  "Republic of Korea", "Spain", "Sweden", "Switzerland", "Turkey", "United Arab Emirates", "United Kingdom", "USA",
];

/** Countries with a page at UNDP's JPO Service Centre (its "Current partnerships" list), with that page. */
const UNDP_PAGES: Record<string, string> = {
  Australia: "https://www.undp.org/jposc/australia", Austria: "https://www.undp.org/jposc/austria", Belgium: "https://www.undp.org/jposc/belgium",
  Canada: "https://www.undp.org/jposc/canada", China: "https://www.undp.org/jposc/china", Denmark: "https://www.undp.org/jposc/denmark",
  Finland: "https://www.undp.org/jposc/finland", France: "https://www.undp.org/jposc/france", Germany: "https://www.undp.org/jposc/germany",
  Iceland: "https://www.undp.org/jposc/iceland", Italy: "https://www.undp.org/jposc/italy", Japan: "https://www.undp.org/jposc/japan",
  Kuwait: "https://www.undp.org/jposc/kuwait", Luxembourg: "https://www.undp.org/jposc/luxembourg", Norway: "https://www.undp.org/jposc/norway",
};

function Donors() {
  return (
    <div className="rounded-xl border-2 border-brand bg-paper p-5">
      <h2 className="text-xl font-semibold">Is your country a JPO sponsor?</h2>
      <p className="mt-1 text-[0.95rem] text-tint-ink">
        The 41 countries with JPO agreements with the UN, from the UN JPO Programme&apos;s fact sheet (February 2024). Linked countries have a
        page at UNDP&apos;s JPO Service Centre with their own eligibility rules.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.95rem] sm:grid-cols-3">
        {DONORS.map((c) => (
          <li key={c}>{UNDP_PAGES[c] ? <a href={UNDP_PAGES[c]} rel="noopener" className="font-medium text-accent underline">{c}</a> : c}</li>
        ))}
      </ul>
      <p className="mt-3 text-[0.95rem] text-tint-ink">
        <strong>Not from a sponsoring country?</strong> The Netherlands, Italy, Belgium and Switzerland also sponsor candidates from
        developing countries for UN Secretariat JPO posts, according to the UN JPO Programme. Check their current calls.
      </p>
    </div>
  );
}

export default function JpoGuide() {
  return (
    <GuideLayout
      path={PATH}
      title="Junior Professional Officer (JPO) programme"
      crumb="JPO programme"
      description={DESCRIPTION}
      intro="JPO posts are entry-level UN positions paid for by a government, usually for its own nationals. You apply through that government, not to the UN."
      before={<Donors />}
      sections={[
        {
          id: "what",
          title: "What a JPO is",
          body: (
            <>
              <p>
                A Junior Professional Officer is a young professional placed in a UN organization under an agreement between the organization
                and a donor government, which pays the costs of the post. At the UN Secretariat, JPO posts are generally at the P-2 level and
                assignments usually last two years.
              </p>
              <p>
                Many UN agencies run JPO programmes, each with its own donors. UNDP&apos;s JPO Service Centre administers JPOs for several
                organizations; the UN Department of Economic and Social Affairs (DESA) runs the programme for the UN Secretariat.
              </p>
            </>
          ),
        },
        {
          id: "eligibility",
          title: "Who can apply",
          body: (
            <>
              <ul>
                <li>Usually a national of the sponsoring country (some donors also fund developing-country nationals).</li>
                <li>An advanced university degree, usually a Master&apos;s.</li>
                <li>At least two years of relevant professional experience.</li>
                <li>An age limit set by each donor. Many require applicants to be under 32, but it varies: Kuwait, for example, requires applicants to be under 34.</li>
              </ul>
              <p>Always check your own government&apos;s rules: they decide.</p>
            </>
          ),
        },
        {
          id: "how-to-apply",
          title: "How to apply",
          body: (
            <ol className="list-decimal space-y-1.5">
              <li>Find your government&apos;s JPO page. Vacancies are often published through the ministry of foreign affairs or a national agency (Germany&apos;s, for example, is the BFIO, the Federal Employment Agency&apos;s office for international organizations).</li>
              <li>Apply to your government, not to the UN: UN departments don&apos;t take direct JPO applications.</li>
              <li>The government assesses applicants and sends a shortlist to the UN.</li>
              <li>The UN office that will host you interviews the shortlisted candidates and makes the final choice.</li>
            </ol>
          ),
        },
        {
          id: "after",
          title: "After a JPO assignment",
          body: (
            <p>
              A JPO post doesn&apos;t guarantee a job afterwards, but it gives two years of UN experience at the Professional level, which counts
              when you apply for regular posts. See <Link href="/guides/how-to-get-a-un-job">how to get a UN job</Link>.
            </p>
          ),
        },
      ]}
      vacancies={[
        { label: "JPO vacancies listed on this site", href: "/jobs?q=junior%20professional%20officer" },
        { label: "Entry-level posts (P-1, P-2, NO-A)", href: "/jobs?grade=entry" },
      ]}
      sources={[
        { label: "UN JPO Programme fact sheet (UN DESA, February 2024)", href: DESA_FACT_SHEET },
        { label: "UN JPO Programme: how to apply (UN DESA)", href: DESA_HOW_TO_APPLY },
        { label: "UNDP JPO Service Centre: current partnerships", href: "https://www.undp.org/jposc/current-partnerships" },
        { label: "UNDP JPO Service Centre: Kuwait", href: "https://www.undp.org/jposc/kuwait" },
        { label: "UNDP JPO Service Centre: Germany", href: "https://www.undp.org/jposc/germany" },
      ]}
    />
  );
}
