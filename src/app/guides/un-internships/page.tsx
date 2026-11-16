import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";

const PATH = "/guides/un-internships";
const TITLE = "UN internships: which are paid, who can apply and how";
const DESCRIPTION =
  "Which UN agencies pay interns a stipend (UNICEF, UNDP, UNHCR, WHO, FAO, ILO, UNFPA, WIPO) and which don't, who is eligible, how long internships last and how to apply.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

/**
 * Each organization's own statement, checked on the date in GUIDES_CHECKED. Only organizations whose
 * own page states its policy are listed; add more the same way.
 */
const PAY: { org: string; pay: string; detail: string; href: string }[] = [
  { org: "UNICEF", pay: "Paid", detail: "All interns are entitled to a stipend towards living expenses, paid by UNICEF or a partner institution. Usually 6 to 26 weeks.", href: "https://unicef.org/careers/frequently-asked-questions-internships" },
  { org: "UNHCR", pay: "Paid", detail: "Interns without outside funding get an allowance: 70% of the local G-3 step 1 net salary for full-time interns (50% in \"H\" duty stations). Usually 2 to 6 months.", href: "https://unhcr.org/node/5265" },
  { org: "FAO", pay: "Paid", detail: "A stipend in local currency of up to US$700 a month; sponsored interns are paid by their sponsor. 3 to 11 months.", href: "https://www.fao.org/employment/young-talent-programme/internship-programme/faqs/en" },
  { org: "UNDP", pay: "Paid", detail: "A monthly stipend, normally in the local payroll currency.", href: "https://popp.undp.org/procedure/internship" },
  { org: "UNFPA", pay: "Paid if not funded", detail: "Interns without financial support from a university, government or other party may receive a monthly stipend, based on the place of work.", href: "https://www.unfpa.org/jobs/global-internship-roster-2026" },
  { org: "ILO", pay: "Paid if not funded", detail: "A stipend for basic subsistence costs, for interns not supported by an institution. 3 to 6 months.", href: "https://jobs.ilo.org/content/Internships/?locale=en_GB" },
  { org: "WIPO", pay: "Paid", detail: "A stipend towards the cost of living; any university or government funding is deducted from it.", href: "https://www.wipo.int/en/web/working-at-wipo/internship-program/faqs" },
  { org: "WHO", pay: "Paid if needed", detail: "A living allowance for selected interns who need financial support (since January 2020). 6 to 24 weeks.", href: "https://www.who.int/careers/internships" },
  { org: "UN Secretariat", pay: "Unpaid", detail: "Interns are not paid; travel, insurance, accommodation and living costs are borne by the intern or a sponsor. 2 to 6 months.", href: "https://www.un.org/sites/un2.un.org/files/2021/07/internship_quick_guide_fact_sheet.pdf" },
];

const tone = (p: string) => (p === "Unpaid" ? "bg-[#fdecea] text-[#9b2c1f]" : p === "Paid" ? "bg-remote-bg text-remote" : "bg-[#fff4d6] text-[#7a5300]");

function PayTable() {
  return (
    <div className="rounded-xl border-2 border-brand bg-paper p-5">
      <h2 className="text-xl font-semibold">Which UN internships are paid?</h2>
      <p className="mt-1 text-[0.95rem] text-tint-ink">What each organization says on its own internship page. Follow the link for the current terms.</p>
      <ul className="mt-4 divide-y divide-rule">
        {PAY.map((p) => (
          <li key={p.org} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <a href={p.href} rel="noopener" className="font-semibold text-ink underline decoration-rule underline-offset-2 hover:text-accent">{p.org}</a>
              <span className={`rounded-full px-2.5 py-0.5 text-[0.8125rem] font-bold ${tone(p.pay)}`}>{p.pay}</span>
            </div>
            <p className="mt-1 text-[0.95rem] text-tint-ink">{p.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate">Only organizations whose own pages state their policy are listed.</p>
    </div>
  );
}

export default function UnInternshipsGuide() {
  return (
    <GuideLayout
      path={PATH}
      title={TITLE}
      crumb="UN internships"
      description={DESCRIPTION}
      intro="Internships are the usual first step into the UN system for students and recent graduates. Whether you are paid depends on the organization."
      before={<PayTable />}
      sections={[
        {
          id: "who-can-apply",
          title: "Who can apply",
          body: (
            <>
              <p>Rules differ by organization, but most internships are for current students and recent graduates. For example:</p>
              <ul>
                <li>The <strong>UN Secretariat</strong> takes students in a Master&apos;s or PhD programme, in the final year of a Bachelor&apos;s, or within one year of graduating from one of these, with excellent English or French.</li>
                <li><strong>FAO</strong> requires that your 31st birthday does not fall before the internship starts.</li>
                <li>The <strong>ILO</strong> takes final-year Master&apos;s students or those who finished one in the past year, and has no age limit.</li>
                <li><strong>WIPO</strong> accepts students and those who graduated within the last two years.</li>
              </ul>
              <p>Many organizations exclude close relatives of their own staff and people who have interned with them before.</p>
            </>
          ),
        },
        {
          id: "how-long",
          title: "How long internships last",
          body: <p>Usually between two and six months, full-time. Some run longer: FAO internships last 3 to 11 months, and UNHCR allows extensions up to eight months full-time.</p>,
        },
        {
          id: "how-to-apply",
          title: "How to apply",
          body: (
            <>
              <p>
                Each organization has its own system. At the UN Secretariat, internships are advertised on the UN Careers portal under the
                Internship category, and you apply through an Inspira profile. Other agencies post individual internships or open a roster
                once or twice a year (the ILO, for example, usually in April and October).
              </p>
              <p>
                Answer the vacancy&apos;s competencies directly in your cover letter, and include the job ID. Real UN organizations never charge a
                fee at any stage of recruitment.
              </p>
            </>
          ),
        },
        {
          id: "after",
          title: "After the internship",
          body: (
            <p>
              An internship does not lead to a job by itself, but it gives you experience, contacts and a reference in the system. Check the
              terms of the organization you intern with for any rules on applying for posts afterwards. For the next steps, see{" "}
              <Link href="/guides/how-to-get-a-un-job">how to get a UN job</Link>.
            </p>
          ),
        },
      ]}
      vacancies={[
        { label: "Open internships", href: "/jobs?type=Internship" },
        { label: "Traineeships (EU and others)", href: "/jobs?type=Traineeship" },
      ]}
      sources={PAY.map((p) => ({ label: `${p.org}: internship terms`, href: p.href }))}
    />
  );
}
