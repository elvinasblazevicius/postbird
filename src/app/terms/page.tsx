import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms" } };

// Starter text — have it reviewed before you charge for Premium.
export default function TermsPage() {
  return (
    <>
      <PageHeader title="Terms of use" crumbs={[{ href: "/", label: "Home" }, { href: "/terms", label: "Terms" }]} />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        <p>{siteConfig.disclaimer}</p>
        <h2 className="text-xl font-semibold">Listings</h2>
        <p>
          Vacancy information is taken from public sources and may be incomplete, out of date or changed by the employer. Always check the official posting before applying.
          Vacancy content remains the property of the organizations that publish it.
        </p>
        <h2 className="text-xl font-semibold">No recruitment services</h2>
        <p>We don&apos;t recruit, accept applications or act for any employer. We never ask job seekers for payment to apply.</p>
        <h2 className="text-xl font-semibold">Removal requests</h2>
        <p>
          Organizations that want a listing corrected or removed can contact us{siteConfig.contactEmail ? <> at <a className="text-accent hover:underline" href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a></> : null}.
        </p>
      </div>
    </>
  );
}
