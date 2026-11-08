import type { Metadata } from "next";
import Link from "next/link";
import { AlertSignup } from "@/components/alert-signup";
import { PageHeader } from "@/components/page-header";
import { PremiumInterestForm } from "@/components/token-forms";
import { siteConfig } from "@/lib/site";

const free = siteConfig.freeWeeklyEmail;

export const metadata: Metadata = {
  title: free
    ? "Free weekly job alerts for UN, international organization and NGO vacancies"
    : "Email job alerts for UN, international organization and NGO vacancies",
  description: free
    ? "Get a free Monday email with the week's newest vacancies at UN agencies, international organizations and NGOs. Unsubscribe with one click."
    : "New UN, international organization and NGO vacancies by email, filtered by role, organization and location, with deadline reminders.",
  alternates: { canonical: "/alerts" },
};

export default function AlertsPage() {
  const p = siteConfig.premium;
  return (
    <>
      <PageHeader
        title={free ? "Weekly job alerts" : "Email job alerts"}
        crumbs={[{ href: "/", label: "Home" }, { href: "/alerts", label: "Job alerts" }]}
        intro={
          free
            ? "A short email every Monday with the newest international vacancies. Free, and you can unsubscribe with one click."
            : `New vacancies in your inbox, filtered to the roles, organizations and places you choose. ${p.trialDays}-day free trial, then ${p.priceSummary}.`
        }
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="max-w-xl">{free ? <AlertSignup source="alerts-page" /> : <PremiumInterestForm source="alerts-page" />}</div>
        <div className="rounded-2xl border border-rule bg-candy-soft p-6">
          <h2 className="text-xl font-semibold text-ink">What you&apos;ll get</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-slate">
            {free ? (
              <>
                <li>The week&apos;s newest openings, each linked to the official posting</li>
                <li>Deadlines shown up front, so you can prioritise</li>
                <li>No spam and no sharing of your address</li>
              </>
            ) : (
              p.features.map((f) => <li key={f}>{f}</li>)
            )}
          </ul>
          <p className="mt-5 text-slate">
            Browsing and searching every vacancy stays free. <Link href="/pricing" className="font-medium text-accent hover:underline">See pricing</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
