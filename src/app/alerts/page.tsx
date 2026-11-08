import type { Metadata } from "next";
import Link from "next/link";
import { AlertSignup } from "@/components/alert-signup";
import { PageHeader } from "@/components/page-header";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Free weekly job alerts for UN, international organization and NGO vacancies",
  description: "Get a free Monday email with the week's newest vacancies at UN agencies, international organizations and NGOs. Unsubscribe with one click.",
  alternates: { canonical: "/alerts" },
};

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Weekly job alerts"
        crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: "Job alerts" }]}
        intro="A short email every Monday with the newest international vacancies. Free, and you can unsubscribe with one click."
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="max-w-xl">
          <AlertSignup source="alerts-page" />
        </div>
        <div className="rounded-xl border border-rule p-6">
          <h2 className="text-xl font-semibold text-ink">What you&apos;ll get</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate">
            <li>The week&apos;s newest openings, each linked to the official posting</li>
            <li>Deadlines shown up front, so you can prioritise</li>
            <li>No spam and no sharing of your address</li>
          </ul>
          <p className="mt-5 text-slate">
            Want daily alerts for specific roles, organizations or places?{" "}
            <Link href="/pricing" className="font-medium text-accent hover:underline">See {siteConfig.premium.name}</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
