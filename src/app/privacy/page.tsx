import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };

// Starter text — have it reviewed for the countries you operate in before launch.
export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy" crumbs={[{ href: "/", label: "Home" }, { href: "/privacy", label: "Privacy" }]} />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        <p>This page explains what {siteConfig.name} collects and why.</p>
        <h2 className="text-xl font-semibold">Browsing</h2>
        <p>
          We count page views, searches and clicks on application links to understand which listings are useful. We don&apos;t use cookies for this and don&apos;t store IP addresses:
          visits are counted with an anonymous code that changes every day. We don&apos;t use advertising trackers.
        </p>
        <h2 className="text-xl font-semibold">Email alerts and Premium sign-ups</h2>
        <p>
          If you subscribe, we store your email address, what you signed up for, any preferences you entered, and when you confirmed. We use it only to send the emails you asked for.
          Every email has a one-click unsubscribe link. Emails are delivered by our email provider (Resend) on our behalf.
        </p>
        <h2 className="text-xl font-semibold">Applications</h2>
        <p>We don&apos;t receive job applications. When you apply, you do so on the employer&apos;s website under its own privacy policy.</p>
        <h2 className="text-xl font-semibold">Your choices</h2>
        <p>
          You can unsubscribe at any time.{" "}
          {siteConfig.contactEmail ? <>To have your data deleted, email <a className="text-accent hover:underline" href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>.</> : "To have your data deleted, contact us."}
        </p>
      </div>
    </>
  );
}
