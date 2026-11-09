import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "How it works and where our listings come from",
  description: `How ${siteConfig.name} finds international vacancies, what we show, and how to apply.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <PageHeader title="How it works" crumbs={[{ href: "/", label: "Home" }, { href: "/about", label: "How it works" }]} />
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-12 text-[1.05rem] leading-relaxed text-ink sm:px-6">
        <section>
          <h2 className="text-2xl font-semibold">Where the vacancies come from</h2>
          <p className="mt-3">
            {siteConfig.name} collects vacancies from public job feeds several times a day. New openings are added automatically, each one is linked to the
            employer&apos;s own website, and vacancies are hidden once their published closing date has passed.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold">What we show</h2>
          <p className="mt-3">
            For each vacancy we show the details the source publishes: title, organization, location, dates and, where the source allows it, a summary or the full description.
            When a detail isn&apos;t published, the listing says &quot;Not stated&quot; rather than guessing. Categories are assigned from the job title.
          </p>
          <p className="mt-3">
            The same vacancy often appears on several websites. We combine those copies into a single listing that links to the employer&apos;s own website. Listings without a link to the employer aren&apos;t shown.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold">How to apply</h2>
          <p className="mt-3">
            Every listing has an <strong>Apply</strong> button that opens the employer&apos;s own website: the vacancy itself, the employer&apos;s application form, or its careers page when that is all the posting links to. Applications go directly to the employer.
            We never accept applications, and genuine international organizations don&apos;t charge fees at any stage of recruitment. Treat any request for payment as a scam.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-semibold">Independence</h2>
          <p className="mt-3">{siteConfig.disclaimer}</p>
          <p className="mt-3">{siteConfig.name} is run by {siteConfig.operator.name}, {siteConfig.operator.address}.</p>
          <p className="mt-3">
            Spotted a mistake or a listing that shouldn&apos;t be here?{" "}
            {siteConfig.contactEmail ? <a href={`mailto:${siteConfig.contactEmail}`} className="text-accent underline">Email us at {siteConfig.contactEmail}</a> : "Let us know"} and we&apos;ll fix or remove it.
          </p>
        </section>
        <p><Link href="/jobs" className="font-medium text-accent hover:underline">Browse open vacancies</Link></p>
      </div>
    </>
  );
}
