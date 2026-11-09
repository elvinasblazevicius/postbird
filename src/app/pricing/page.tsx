import type { Metadata } from "next";
import Link from "next/link";
import { AlertExample } from "@/components/alert-example";
import { PageHeader } from "@/components/page-header";
import { TrackedLink } from "@/components/tracking";
import { BILLING_LIVE } from "@/lib/billing/live";
import { EARLY_ACCESS_BUTTON, earlyAccessLine } from "@/lib/early-access-copy";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — email alerts for international jobs",
  description: `Browsing every vacancy is free. ${siteConfig.premium.name}: new vacancies by email, filtered by keyword, organization and location. ${siteConfig.premium.trialDays}-day free trial, then ${siteConfig.premium.priceSummary}.`,
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
  const billingFaq: [string, React.ReactNode][] = BILLING_LIVE
    ? [
        [
          "How does the free trial work?",
          <>You pay $0 for {p.trialDays} days. A card is needed to start. If you don&apos;t cancel before day {p.trialDays}, the plan you chose starts automatically.</>,
        ],
        [
          "How do I cancel?",
          <>Every alert email links to your account, where &quot;Manage billing or cancel&quot; opens Paddle&apos;s page to cancel. Lost the email? <Link href="/account/login" className="text-accent underline">Get your account link</Link>. You keep alerts until the end of the period you paid for.</>,
        ],
        ["Who handles the payment?", <>Paddle.com, our reseller and merchant of record. It handles payment, invoices and tax; we never see your card details.</>],
        ["Can I get a refund?", <>Yes. If a charge was unexpected, email us within 14 days of it and we&apos;ll refund it in full. <Link href="/terms#refunds" className="text-accent underline">Refund policy</Link></>],
      ]
    : [
        ["Is anything charged now?", <>No. Email alerts aren&apos;t open yet. Joining early access is free and needs no card.</>],
        [
          "What happens when alerts open?",
          <>You get one email offering the {p.trialDays}-day free trial. Nothing is charged until you choose a plan ({p.priceSummary}).</>,
        ],
        ["What if you don't launch?", <>We&apos;ll tell you, and delete your address within 30 days.</>],
        ["Can I unsubscribe?", <>Yes, at any time: every email has a one-click unsubscribe link.</>],
      ];
  const quarterly = p.plans.find((x) => "perMonth" in x && x.perMonth);
  const trialLine = `Card required. $0 today. After the ${p.trialDays}-day free trial, ${quarterly?.price ?? ""} every 3 months or ${p.plans[0]?.price ?? ""} a month (the plan you choose), renewing automatically until you cancel. Cancel any time before the trial ends and you pay nothing.`;
  const faq: [string, React.ReactNode][] = [
    ...billingFaq,
    [
      "Where do the listings come from?",
      <>From public job feeds. Every listing links to the employer&apos;s own website, where you apply. We never charge anyone to apply for a job.</>,
    ],
    ["Are you part of the UN?", <>No. {siteConfig.name} is independent and not affiliated with the United Nations, the EU or any employer listed.</>],
  ];

  return (
    <>
      <PageHeader
        title="Pricing"
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }]}
        intro={`Every vacancy, search and filter is free. Paid email alerts${BILLING_LIVE ? "" : ", launching soon,"} bring new matches to your inbox so you don't have to keep checking.`}
      />
      <div className="mx-auto grid max-w-4xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-rule p-7" aria-labelledby="plan-free">
          <h2 id="plan-free" className="text-2xl font-semibold text-ink">Free</h2>
          <p className="mt-2"><span className="font-display text-4xl font-semibold text-ink">$0</span></p>
          <ul className="mt-6 flex-1 space-y-3 text-ink">
            {["Browse and search every vacancy", "Filter by organization, country, category and deadline", "Add closing dates to your calendar", ...(siteConfig.freeWeeklyEmail ? ["Weekly email with new vacancies"] : [])].map((f) => (
              <li key={f} className="flex gap-2.5"><Check />{f}</li>
            ))}
          </ul>
          <Link href={siteConfig.freeWeeklyEmail ? "/alerts" : "/jobs"} className="mt-8 rounded-lg border border-rule px-5 py-3 text-center font-semibold text-ink hover:bg-mist">
            {siteConfig.freeWeeklyEmail ? "Get the weekly email" : "Browse jobs"}
          </Link>
        </section>

        <section className="flex flex-col rounded-2xl border-2 border-brand bg-candy-soft p-7" aria-labelledby="plan-premium">
          <div className="flex items-center justify-between gap-3">
            <h2 id="plan-premium" className="text-2xl font-semibold text-ink">{p.name}</h2>
            {BILLING_LIVE ? null : <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-ink">Launching soon</span>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {[...p.plans].reverse().map((plan) => (
              <div key={plan.label} className={`relative rounded-xl bg-paper p-3 ${plan.note ? "border-2 border-remote" : "border border-rule"}`}>
                <dt className="flex items-center justify-between gap-2 text-sm text-slate">
                  {plan.note ? <span className="absolute -top-2.5 right-2 rounded-full bg-remote px-2 py-0.5 text-xs font-semibold text-white">Best value</span> : null}
                  <span>{plan.label}</span>
                  {plan.note ? <span className="rounded-full bg-remote-bg px-2 py-0.5 text-xs font-semibold text-remote">{plan.note}</span> : null}
                </dt>
                <dd className="mt-1">
                  <span className="font-display text-3xl font-semibold text-ink">{plan.price}</span>
                  <span className="block text-sm text-slate">{plan.per === "month" ? "per month" : `for ${plan.per}`}</span>
                  {"perMonth" in plan && plan.perMonth ? <span className="block text-sm font-medium text-remote">= {plan.perMonth} a month</span> : null}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="mt-6 flex-1 space-y-3 text-ink">
            {siteConfig.freeWeeklyEmail ? <li className="flex gap-2.5"><Check />Everything in Free</li> : null}
            {p.features.map((f) => (
              <li key={f} className="flex gap-2.5"><Check />{f}</li>
            ))}
          </ul>
          <TrackedLink href="/pricing/trial" event="premium_cta_click" source="pricing" className="mt-8 rounded-lg bg-brand px-5 py-3 text-center font-semibold text-white hover:bg-accent">
            {BILLING_LIVE ? `Start ${p.trialDays}-day free trial` : EARLY_ACCESS_BUTTON}
          </TrackedLink>
          <p className="mt-3 text-sm text-slate">{BILLING_LIVE ? trialLine : earlyAccessLine()}</p>
        </section>
      </div>

      <div className="mx-auto grid max-w-4xl gap-8 px-4 sm:px-6 md:grid-cols-2">
        <section aria-labelledby="why-heading">
          <h2 id="why-heading" className="text-xl font-semibold text-ink">Why alerts help</h2>
          <p className="mt-3 leading-relaxed text-ink">
            Many international vacancies are open for only two to four weeks, and they are spread across dozens of separate career sites. Alerts check them for you and
            send the new ones that match your searches, so you see a role while there is still time to apply.
          </p>
        </section>
        <AlertExample />
      </div>

      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-xl font-semibold text-ink">Questions</h2>
        <dl className="mt-4 divide-y divide-rule border-y border-rule">
          {faq.map(([q, a]) => (
            <div key={q} className="py-4">
              <dt className="font-semibold text-ink">{q}</dt>
              <dd className="mt-1 leading-relaxed text-ink">{a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-slate">
          Prices in US dollars{BILLING_LIVE ? ", including any sales tax or VAT" : ""}. {siteConfig.name} is run by {siteConfig.operator.name}.{" "}
          <Link href="/terms" className="text-accent underline">Terms</Link> · <Link href="/privacy" className="text-accent underline">Privacy</Link>
        </p>
      </section>
    </>
  );
}
