import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  const op = siteConfig.operator;
  const p = siteConfig.premium;
  const mail = siteConfig.contactEmail;
  return (
    <>
      <PageHeader title="Terms of use" crumbs={[{ href: "/", label: "Home" }, { href: "/terms", label: "Terms" }]} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        <p className="text-sm text-slate">Last updated 9 November 2026</p>
        <p>
          {siteConfig.name} is run by {op.name}, {op.address}
          {mail ? <> (<a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a>)</> : null}. By using the site you agree to these terms.
        </p>
        <p>{siteConfig.disclaimer}</p>

        <h2 className="pt-2 text-xl font-semibold">Listings</h2>
        <p>
          Vacancy information is collected automatically from public job feeds and may be incomplete, out of date or changed by the employer. Details we can&apos;t confirm
          are shown as &quot;Not stated&quot;. Always check the employer&apos;s own posting, including the closing date, before applying. Vacancy content remains the property
          of the organizations that publish it.
        </p>

        <h2 className="pt-2 text-xl font-semibold">No recruitment services</h2>
        <p>We don&apos;t recruit, accept applications or act for any employer. We never ask job seekers for payment to apply for a job.</p>

        <h2 className="pt-2 text-xl font-semibold">Email alerts</h2>
        <p>
          Paid email alerts are not open yet; we are measuring interest first. Joining early access is free and creates no obligation. When alerts open they will cost{" "}
          {p.priceSummary}, with a {p.trialDays}-day free trial that needs no card. Nothing renews or is charged automatically at the end of the trial: you choose then
          whether to pay. Paid plans will be cancellable at any time, and we will publish the full billing terms here before taking any payment.
        </p>

        <h2 className="pt-2 text-xl font-semibold">Liability</h2>
        <p>
          The site is provided as is. To the extent the law allows, {op.name} is not liable for losses arising from errors in listings, missed deadlines or decisions made
          by employers. Nothing in these terms limits rights you have under consumer law where you live.
        </p>

        <h2 className="pt-2 text-xl font-semibold">Corrections and removal</h2>
        <p>
          Organizations that want a listing corrected or removed, and anyone who spots an error, can contact us{mail ? <> at <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a></> : null}.
          We act on removal requests within five working days.
        </p>

        <h2 className="pt-2 text-xl font-semibold">Governing law</h2>
        <p>These terms are governed by the law of {op.governingLaw}, without affecting mandatory consumer protections in your country.</p>
      </div>
    </>
  );
}
