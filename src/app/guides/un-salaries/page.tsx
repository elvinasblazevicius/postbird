import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";
import { SalaryCalculator } from "@/components/salary-calculator";
import { PAY_SOURCES } from "@/lib/grades";
import { EXAMPLE_STATIONS, NET_BASE, NET_BASE_EFFECTIVE, NET_BASE_SOURCE, PA_CIRCULAR, PA_DATA_PAGE, PA_EFFECTIVE, PA_MEMO, multiplierFor, netRemuneration, usd } from "@/lib/un-pay";

const PATH = "/guides/un-salaries";
const TITLE = "UN salaries in 2026: pay by grade and duty station";
const DESCRIPTION =
  "How much UN staff earn: net base salary for P-1 to D-2 from the official ICSC scale, how post adjustment changes pay by duty station, worked examples and a salary calculator.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

const EXAMPLE_GRADES = ["P-2", "P-3", "P-4"];

export default function UnSalariesGuide() {
  return (
    <GuideLayout
      path={PATH}
      title={TITLE}
      crumb="UN salaries"
      description={DESCRIPTION}
      intro="What Professional and Director staff in the UN common system are paid, from the official ICSC figures, and why the same grade pays very differently from one city to another."
      before={<SalaryCalculator />}
      sections={[
        {
          id: "how-pay-works",
          title: "How UN pay is made up",
          body: (
            <>
              <p>
                Internationally recruited staff in the Professional and higher categories (P-1 to P-5, D-1, D-2 and above) are paid a{" "}
                <strong>net base salary</strong>, which is the same everywhere, plus a <strong>post adjustment</strong>, which depends on the
                duty station.
              </p>
              <p>
                The post adjustment exists so that staff anywhere have the same purchasing power as their counterparts in New York, the base of
                the system. It is expressed as a multiplier: a multiplier of 50 adds 50% to the net base salary. Together they make up what the
                International Civil Service Commission (ICSC) calls net remuneration.
              </p>
              <p>
                On top of that come allowances that depend on your situation, such as for dependants, rent, education, or service in hardship or
                non-family duty stations. They are not included in the figures on this page.
              </p>
            </>
          ),
        },
        {
          id: "net-base",
          title: `Net base salary by grade (${NET_BASE_EFFECTIVE})`,
          body: (
            <>
              <div className="overflow-x-auto">
                <table className="w-full max-w-md text-left text-[0.95rem]">
                  <thead>
                    <tr className="border-b border-rule text-sm text-slate">
                      <th scope="col" className="py-1.5 pr-4 font-medium">Grade</th>
                      <th scope="col" className="py-1.5 font-medium">Annual, US dollars, first to highest step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(NET_BASE).map(([g, [lo, hi]]) => (
                      <tr key={g} className="border-b border-rule/60">
                        <th scope="row" className="py-1.5 pr-4 font-semibold">{g}</th>
                        <td className="py-1.5 tabular-nums">{lo === hi ? `${usd(lo)} (one rate)` : `${usd(lo)} to ${usd(hi)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[0.95rem] text-slate">
                From the <a href={NET_BASE_SOURCE} rel="noopener">ICSC salary scale for the Professional and higher categories</a>, effective{" "}
                {NET_BASE_EFFECTIVE}. Each grade has several steps; staff move up a step with service.
              </p>
            </>
          ),
        },
        {
          id: "examples",
          title: "Worked examples: the same grade in different cities",
          body: (
            <>
              <p>
                Net base salary at the first step of the grade, plus the post adjustment for {PA_EFFECTIVE}. Before allowances. The
                calculator above covers every duty station.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[0.95rem]">
                  <thead>
                    <tr className="border-b border-rule text-sm text-slate">
                      <th scope="col" className="py-1.5 pr-4 font-medium">Duty station</th>
                      <th scope="col" className="py-1.5 pr-4 font-medium">Multiplier</th>
                      {EXAMPLE_GRADES.map((g) => <th key={g} scope="col" className="py-1.5 pr-4 font-medium">{g}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_STATIONS.map(({ city, entry }) => {
                      const m = multiplierFor(entry) ?? 0;
                      return (
                        <tr key={city} className="border-b border-rule/60">
                          <th scope="row" className="py-1.5 pr-4 font-semibold">{city}</th>
                          <td className="py-1.5 pr-4 tabular-nums">{m}</td>
                          {EXAMPLE_GRADES.map((g) => <td key={g} className="py-1.5 pr-4 tabular-nums">{usd(netRemuneration(NET_BASE[g][0], m))}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[0.95rem] text-slate">
                Multipliers for {PA_EFFECTIVE} from the <a href={PA_CIRCULAR.href} rel="noopener">ICSC consolidated circular</a>
                {PA_MEMO ? <> with the changes in the <a href={PA_MEMO.href} rel="noopener">monthly memo</a></> : null}. Geneva, Vienna, Copenhagen, Nairobi, Addis Ababa
                and Bangkok take their country&apos;s figure, which the ICSC applies to every duty station in a country listed once. Multipliers
                change monthly: the current figures are on the <a href={PA_DATA_PAGE} rel="noopener">ICSC post adjustment data page</a>.
              </p>
            </>
          ),
        },
        {
          id: "local-staff",
          title: "National Officers and General Service staff",
          body: (
            <>
              <p>
                Locally recruited staff (National Officers, NO-A to NO-E, and General Service, G-1 to G-7) are paid on local salary scales set
                for each duty station, in local currency, based on the best prevailing conditions of employment in that location. Their pay
                is not comparable across countries: see <Link href="/guides/un-local-salaries">local staff salaries by duty station</Link>.
              </p>
              <p>
                <Link href="/grades">Grades and contract types explained</Link> describes each category.
              </p>
            </>
          ),
        },
        {
          id: "other-contracts",
          title: "Consultants, interns, volunteers and EU staff",
          body: (
            <ul>
              <li>Consultants and individual contractors are paid a fee set in their contract, usually a daily or monthly rate; it is not on the UN salary scale.</li>
              <li>Interns are not staff. Some organizations pay a stipend and some pay nothing: see <Link href="/guides/un-internships">which UN internships are paid</Link>.</li>
              <li>UN Volunteers receive a living allowance, not a salary: see the <Link href="/guides/un-volunteers">UN Volunteers guide</Link>.</li>
              <li>EU institutions have their own pay scales: see the <a href={PAY_SOURCES.euSalaries} rel="noopener">EU salary levels page</a>.</li>
            </ul>
          ),
        },
      ]}
      vacancies={[
        { label: "Professional posts (P-1 to P-5)", href: "/jobs?grade=P" },
        { label: "Entry-level posts (P-1, P-2, NO-A)", href: "/jobs?grade=entry" },
        { label: "Director posts and above", href: "/jobs?grade=D" },
      ]}
      sources={[
        { label: `ICSC salary scale for the Professional and higher categories, effective ${NET_BASE_EFFECTIVE}`, href: NET_BASE_SOURCE },
        PA_CIRCULAR,
        ...(PA_MEMO ? [PA_MEMO] : []),
        { label: "ICSC: post adjustment", href: PAY_SOURCES.icscPostAdjustment },
        { label: "ICSC salary scales", href: PAY_SOURCES.icscSalaryScales },
      ]}
    />
  );
}
