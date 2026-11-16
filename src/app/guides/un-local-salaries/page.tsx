import type { Metadata } from "next";
import Link from "next/link";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";
import { LocalPayCalculator, type PickerStation } from "@/components/local-pay-calculator";
import { countryByCode } from "@/config/countries";
import { LOCAL_PAY_FAQ, LOCAL_PAY_PATH, LOCAL_PAY_SOURCE, LOCAL_PAY_RATES_DATE, LOCAL_PAY_STATIONS, stationLabel, UN_RATES_SOURCE, stationsByCountry } from "@/lib/local-pay";

const TITLE = "UN local staff salaries: General Service and National Officer pay by duty station";
const DESCRIPTION =
  "Annual net pay for UN General Service (G-1 to G-7) and National Officer (NO-A to NO-E) grades in every duty station, from the official local salary scales, with a calculator.";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: LOCAL_PAY_PATH },
  ...shareMetadata(sharedTitle(TITLE), DESCRIPTION),
};

export default function LocalSalariesGuide() {
  const stations: PickerStation[] = [...LOCAL_PAY_STATIONS]
    .sort((a, b) => a.country.localeCompare(b.country) || a.station.localeCompare(b.station))
    .map((s) => {
      // Found by the site's own country name and its aliases too ("USA", "DRC", "Laos").
      const country = countryByCode(s.code);
      const keys = country ? [country.name, ...country.aliases].filter((k) => !stationLabel(s).includes(k)) : [];
      return { slug: s.slug, label: stationLabel(s), keys, currency: s.currency, paidIn: s.paidIn, usdRate: s.usdRate, gs: s.gs, no: s.no };
    });
  return (
    <GuideLayout
      path={LOCAL_PAY_PATH}
      title="UN local staff salaries"
      crumb="Local staff salaries"
      description={DESCRIPTION}
      intro="What General Service and National Officer staff are paid in each duty station, from the UN's official local salary scales."
      before={<LocalPayCalculator stations={stations} ratesDate={LOCAL_PAY_RATES_DATE} />}
      sections={[
        {
          id: "how",
          title: "How local pay is set",
          body: (
            <>
              <p>
                General Service staff (G-1 to G-7) and National Officers (NO-A to NO-E) are recruited locally, and are paid on a salary scale
                set for their duty station, not on the worldwide scale used for international Professional staff. The scales follow a
                methodology set by the International Civil Service Commission (ICSC), based on surveys of the best prevailing conditions of
                employment in the duty station. The ICSC runs the surveys at headquarters duty stations; elsewhere the UN Secretariat does.
              </p>
              <p>
                That is why the same grade pays very differently from one country to another, and why local pay is usually in local currency.
                For international Professional and Director posts, see <Link href="/guides/un-salaries">UN salaries by grade and duty station</Link>.
              </p>
            </>
          ),
        },
        {
          id: "figures",
          title: "What the figures show",
          body: (
            <ul>
              <li>Annual net salary, from the grade&apos;s first step to its highest step. The highest step includes long-service steps, which staff reach only after many years.</li>
              <li>Not included: allowances such as those for dependants or languages, which each scale lists separately.</li>
              <li>The currency the scale is set in. In some countries the scale is set in US dollars and paid in local currency.</li>
              <li>
                An approximate US dollar amount, at the <a href={UN_RATES_SOURCE} rel="noopener">UN operational rate of exchange</a> of{" "}
                {LOCAL_PAY_RATES_DATE}. Staff are paid in the scale&apos;s currency, so the dollar amount moves with the exchange rate.
              </li>
              <li>The date the scale took effect. Scales are revised at different times in each duty station, and a few have not been revised for years.</li>
              <li>Where a country has one scale, it applies to every duty station in that country.</li>
            </ul>
          ),
        },
        {
          id: "who",
          title: "Who these jobs are for",
          body: (
            <p>
              Local posts are generally open only to nationals of the country, or to people already living there with the right to work. Read
              the vacancy&apos;s eligibility section: <Link href="/guides/how-to-read-a-un-vacancy">how to read a UN vacancy</Link> explains
              where to find it.
            </p>
          ),
        },
        {
          id: "stations",
          title: "Every duty station",
          body: (
            <ul className="!list-none columns-1 !ml-0 sm:columns-2 [&_li]:!ml-0">
              {stationsByCountry().map(({ country, stations: list }) => (
                <li key={country} className="break-inside-avoid">
                  {list.map((s, i) => (
                    <span key={s.slug}>
                      {i ? ", " : null}
                      <Link href={`${LOCAL_PAY_PATH}/${s.slug}`}>{stationLabel(s)}</Link>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ),
        },
      ]}
      vacancies={[
        { label: "General Service posts (G-1 to G-7)", href: "/jobs?grade=G" },
        { label: "National Officer posts (NO-A to NO-E)", href: "/jobs?grade=NO" },
      ]}
      sources={[
        { label: "United Nations: salary scales for locally recruited staff, by duty station", href: LOCAL_PAY_SOURCE },
        { label: "ICSC: where to find the General Service salary scale for each duty station", href: LOCAL_PAY_FAQ },
        { label: "United Nations: operational rates of exchange", href: UN_RATES_SOURCE },
      ]}
    />
  );
}
