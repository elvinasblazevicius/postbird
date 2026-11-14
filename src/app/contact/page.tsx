import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import siteConfig from "@site-config";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: `Write to the ${siteConfig.name} team: questions, billing, problems or partnerships.`,
};

type Props = { searchParams: Promise<{ from?: string; topic?: string }> };

export default async function ContactPage({ searchParams }: Props) {
  const sp = await searchParams;
  const from = typeof sp.from === "string" && /^\/[^/]/.test(sp.from) ? sp.from.slice(0, 300) : null;
  return (
    <>
      <PageHeader
        title="Contact us"
        crumbs={[{ href: "/", label: "Home" }, { href: "/contact", label: "Contact" }]}
        intro={`Questions about ${siteConfig.name}, your alerts or a payment: write to us here and we reply by email.`}
      />
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <p className="mb-6 rounded-xl border border-rule bg-mist px-4 py-3 text-[0.95rem] text-ink">
          We can&apos;t help with applications or vacancies themselves: {siteConfig.name} is independent of the employers listed. For a
          vacancy, use the contact details on the employer&apos;s own posting.
        </p>
        <ContactForm topic={typeof sp.topic === "string" ? sp.topic : undefined} page={from} />
        <p className="mt-6 text-sm text-slate">
          {siteConfig.contactEmail ? <>You can also email <a href={`mailto:${siteConfig.contactEmail}`} className="underline underline-offset-2 hover:text-accent">{siteConfig.contactEmail}</a>. </> : null}
          We use your address only to reply. <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">Privacy policy</Link>
        </p>
      </div>
    </>
  );
}
