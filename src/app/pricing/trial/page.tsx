import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PremiumInterestForm } from "@/components/token-forms";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: `Reserve your ${siteConfig.premium.name} free trial`,
  robots: { index: false, follow: true },
  alternates: { canonical: "/pricing/trial" },
};

/**
 * "Fake door" step: the visitor clicked "Start free trial". We say plainly
 * that Premium isn't open yet and record their interest instead.
 */
export default function TrialPage() {
  const p = siteConfig.premium;
  return (
    <>
      <PageHeader
        title={`${p.name} opens soon`}
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Premium" }, { href: "/pricing/trial", label: "Free trial" }]}
        intro={
          <>
            We&apos;re setting up {p.name} now and haven&apos;t started trials yet. Leave your email and what you&apos;d like alerts for, and
            you&apos;ll be among the first to get the {p.trialDays}-day free trial when it opens. Nothing is charged today.
          </>
        }
      />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <PremiumInterestForm />
      </div>
    </>
  );
}
