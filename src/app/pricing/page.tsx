import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { TrackedLink } from "@/components/tracking";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing — email alerts for international jobs",
  description: `Browse every vacancy free. ${siteConfig.premium.name}: new vacancies by email, filtered by keyword, organization and location, with deadline reminders.`,
  alternates: { canonical: "/pricing" },
};

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 shrink-0 text-remote" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function PricingPage() {
  const p = siteConfig.premium;
  return (
    <>
      <PageHeader
        title="Simple plans"
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }]}
        intro={`Every vacancy, search and filter stays free. Pay only if you want the right roles to find you by email.`}
      />
      <div className="mx-auto grid max-w-4xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-rule p-7" aria-labelledby="plan-free">
          <h2 id="plan-free" className="text-2xl font-semibold text-ink">Free</h2>
          <p className="mt-2"><span className="font-display text-4xl font-semibold text-ink">$0</span></p>
          <ul className="mt-6 flex-1 space-y-3 text-ink">
            {["Browse and search every vacancy", "Filter by organization, country, category and deadline", ...(siteConfig.freeWeeklyEmail ? ["Weekly email with new vacancies"] : [])].map((f) => (
              <li key={f} className="flex gap-2.5"><Check />{f}</li>
            ))}
          </ul>
          {siteConfig.freeWeeklyEmail ? (
            <Link href="/alerts" className="mt-8 rounded-lg border border-rule px-5 py-3 text-center font-semibold text-ink hover:bg-mist">Get the weekly email</Link>
          ) : (
            <Link href="/jobs" className="mt-8 rounded-lg border border-rule px-5 py-3 text-center font-semibold text-ink hover:bg-mist">Browse jobs</Link>
          )}
        </section>

        <section className="flex flex-col rounded-2xl border-2 border-brand bg-candy-soft p-7 shadow-[0_18px_40px_-22px_rgba(29,91,255,0.6)]" aria-labelledby="plan-premium">
          <h2 id="plan-premium" className="text-2xl font-semibold text-ink">{p.name}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {p.plans.map((plan) => (
              <div key={plan.label} className="rounded-xl border border-rule bg-paper p-3">
                <div className="flex items-center justify-between gap-2 text-sm text-slate">
                  <span>{plan.label}</span>
                  {plan.note ? <span className="rounded-full bg-signal-bg px-2 py-0.5 text-xs font-semibold text-signal">{plan.note}</span> : null}
                </div>
                <p className="mt-1">
                  <span className="font-display text-3xl font-semibold text-ink">{plan.price}</span>
                  <span className="text-sm text-slate"> / {plan.per}</span>
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate">{p.trialDays}-day free trial. No card needed to start.</p>
          <ul className="mt-6 flex-1 space-y-3 text-ink">
            {siteConfig.freeWeeklyEmail ? <li className="flex gap-2.5"><Check />Everything in Free</li> : null}
            {p.features.map((f) => (
              <li key={f} className="flex gap-2.5"><Check />{f}</li>
            ))}
          </ul>
          <TrackedLink href="/pricing/trial" event="premium_cta_click" className="mt-8 rounded-lg bg-brand px-5 py-3 text-center font-semibold text-white hover:bg-accent">
            Start {p.trialDays}-day free trial
          </TrackedLink>
        </section>
      </div>
      <p className="mx-auto max-w-4xl px-4 text-sm text-slate sm:px-6">
        Prices in US dollars. Cancel any time. {siteConfig.name} never charges job seekers to apply for a vacancy.
      </p>
    </>
  );
}
