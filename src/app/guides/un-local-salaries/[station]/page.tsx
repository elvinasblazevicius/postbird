import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sharedTitle, shareMetadata } from "@/lib/share-metadata";
import { GuideLayout } from "@/components/guide-layout";
import { countryByCode } from "@/config/countries";
import {
  effectiveLabel, LOCAL_PAY_FAQ, LOCAL_PAY_PATH, LOCAL_PAY_SOURCE, LOCAL_PAY_STATIONS, localPayStation, money, stationLabel,
  inUsd, LOCAL_PAY_RATES_DATE, linksToCountry, postAdjustmentForStation, UN_RATES_SOURCE, usdMoney, type LocalPayScale, type LocalPayStation,
} from "@/lib/local-pay";

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCAL_PAY_STATIONS.map((s) => ({ station: s.slug }));
}

type Props = { params: Promise<{ station: string }> };

const titleFor = (s: LocalPayStation) => `UN salaries in ${stationLabel(s)}: General Service and National Officer pay`;
const descriptionFor = (s: LocalPayStation) =>
  `Annual net pay for UN ${[s.gs ? "General Service (G)" : null, s.no ? "National Officer (NO)" : null].filter(Boolean).join(" and ")} grades in ${stationLabel(s)}, from the official local salary scale, in ${s.currency}.`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = localPayStation((await params).station);
  if (!s) return {};
  const path = `${LOCAL_PAY_PATH}/${s.slug}`;
  return {
    title: titleFor(s),
    description: descriptionFor(s),
    alternates: { canonical: path },
    ...shareMetadata(sharedTitle(titleFor(s)), descriptionFor(s)),
  };
}

/** The amount, with its US dollar value under it when the scale is in another currency. */
function Amount({ value, station }: { value: number; station: LocalPayStation }) {
  const usd = inUsd(value, station);
  return (
    <>
      {money(value, station.currency)}
      {usd !== null ? <span className="block text-sm text-slate">about {usdMoney(usd)}</span> : null}
    </>
  );
}

function ScaleTable({ title, scale, station }: { title: string; scale: LocalPayScale; station: LocalPayStation }) {
  const currency = station.currency;
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-slate">
        Effective {effectiveLabel(scale.effective)}{scale.note ? `, ${scale.note}` : ""}. Annual net, in {currency}.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[0.95rem]">
          <thead>
            <tr className="border-b border-rule text-sm text-slate">
              <th scope="col" className="py-1.5 pr-4 font-medium">Grade</th>
              <th scope="col" className="py-1.5 pr-4 font-medium">First step</th>
              <th scope="col" className="py-1.5 pr-4 font-medium">Highest step</th>
              <th scope="col" className="py-1.5 font-medium">Net per month, first step</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(scale.grades).map(([g, [lo, hi]]) => (
              <tr key={g} className="border-b border-rule/60">
                <th scope="row" className="py-1.5 pr-4 align-top font-semibold">{g}</th>
                <td className="py-1.5 pr-4 align-top tabular-nums"><Amount value={lo} station={station} /></td>
                <td className="py-1.5 pr-4 align-top tabular-nums"><Amount value={hi} station={station} /></td>
                <td className="py-1.5 align-top tabular-nums"><Amount value={lo / 12} station={station} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function StationSalaries({ params }: Props) {
  const s = localPayStation((await params).station);
  if (!s) notFound();
  const path = `${LOCAL_PAY_PATH}/${s.slug}`;
  const country = linksToCountry(s) ? countryByCode(s.code) : undefined;
  const pa = postAdjustmentForStation(s.code, s.station);
  const scales = (
    <div className="rounded-xl border-2 border-brand bg-paper p-5">
      {s.gs ? <ScaleTable title="General Service (G)" scale={s.gs} station={s} /> : null}
      {s.no ? <ScaleTable title="National Officer (NO)" scale={s.no} station={s} /> : null}
      <p className="mt-4 text-sm text-slate">
        From the first step to the highest; the highest includes long-service steps. Allowances are not included.
        {s.usdRate ? <> US dollar amounts use the <a href={UN_RATES_SOURCE} rel="noopener" className="text-accent underline">UN operational rate of exchange</a> of {LOCAL_PAY_RATES_DATE} ({s.usdRate.toLocaleString("en-US")} {s.currency} to the dollar) and move with it.</> : null}{" "}
        <Link href={`${LOCAL_PAY_PATH}?station=${s.slug}#calculator`} className="text-accent underline">Compare with another duty station</Link>
      </p>
    </div>
  );
  return (
    <GuideLayout
      path={path}
      title={`UN salaries in ${stationLabel(s)}`}
      crumb={stationLabel(s)}
      parent={{ href: LOCAL_PAY_PATH, label: "Local staff salaries" }}
      description={descriptionFor(s)}
      intro={`What locally recruited UN staff in ${stationLabel(s)} are paid, from the duty station's official salary scale.`}
      before={scales}
      sections={[
        {
          id: "scale",
          title: "About this scale",
          body: (
            <ul>
              {s.countryWide && country ? <li>The scale for {s.station} applies to every UN duty station in {country.name}.</li> : null}
              <li>
                It is set in {s.currency}
                {s.paidIn !== s.currency ? `, and paid in ${s.paidIn}` : ""}.
              </li>
              {!s.gs ? <li>No General Service scale for {s.station} is published on the UN salary scale site.</li> : null}
              {!s.no ? <li>No National Officer scale for {s.station} is published on the UN salary scale site.</li> : null}
              <li>Scales are revised from time to time; the date above is when this one took effect. The UN salary scale site always has the current one.</li>
            </ul>
          ),
        },
        ...(pa
          ? [{
              id: "international",
              title: "International staff in this duty station",
              body: (
                <p>
                  Internationally recruited Professional staff are paid on the worldwide scale plus a post adjustment, which is {pa.multiplier}%
                  for {pa.place}. <Link href={`/guides/un-salaries?place=${encodeURIComponent(pa.place)}#calculator`}>Work out Professional pay here</Link>.
                </p>
              ),
            }]
          : []),
        {
          id: "who",
          title: "Who can apply for local posts",
          body: (
            <p>
              Local posts are generally open only to nationals of the country, or to people already living there with the right to work. Each
              vacancy says who can apply: see <Link href="/guides/how-to-read-a-un-vacancy">how to read a UN vacancy</Link>.
            </p>
          ),
        },
      ]}
      vacancies={[
        ...(country
          ? [
              { label: `General Service posts in ${country.name}`, href: `/jobs?grade=G&country=${country.slug}` },
              { label: `National Officer posts in ${country.name}`, href: `/jobs?grade=NO&country=${country.slug}` },
              { label: `All vacancies in ${country.name}`, href: `/locations/${country.slug}` },
            ]
          : [{ label: "General Service posts", href: "/jobs?grade=G" }, { label: "National Officer posts", href: "/jobs?grade=NO" }]),
      ]}
      sources={[
        { label: `United Nations: salary scales for locally recruited staff (choose ${linksToCountry(s) ? `${s.country}, ` : ""}${s.station})`, href: LOCAL_PAY_SOURCE },
        { label: "ICSC: where to find the General Service salary scale for each duty station", href: LOCAL_PAY_FAQ },
        ...(s.usdRate ? [{ label: "United Nations: operational rates of exchange", href: UN_RATES_SOURCE }] : []),
      ]}
    />
  );
}
