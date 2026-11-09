import type { Metadata } from "next";
import Link from "next/link";
import { AlertExample } from "@/components/alert-example";
import { PageHeader } from "@/components/page-header";
import { TrackedLink } from "@/components/tracking";
import { BILLING_LIVE } from "@/lib/billing/live";
import { EARLY_ACCESS_BUTTON, earlyAccessLine, TAX_LINE } from "@/lib/early-access-copy";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — email alerts for international jobs",
  description: siteConfig.freeWeeklyEmail
    ? `Browsing every vacancy is free, and so is a weekly email with new matches for one search. Daily ${siteConfig.premium.name.toLowerCase()} with up to 5 searches: ${siteConfig.premium.trialDays}-day free trial, then ${siteConfig.premium.priceSummary}.`
    : `Browsing every vacancy is free. ${siteConfig.premium.name}: new vacancies by email, filtered by keyword, organization and location. ${siteConfig.premium.trialDays}-day free trial, then ${siteConfig.premium.priceSummary}.`,
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
        ["Can I get a refund?", <>Yes. Email us within 14 days of any charge and we&apos;ll refund that charge in full, no questions asked. <Link href="/refunds" className="text-accent underline">Refund policy</Link></>],
      ]
    : [
        ["Is anything charged now?", <>No. {siteConfig.freeWeeklyEmail ? "The weekly email is free, and paid daily alerts aren't open yet." : "Email alerts aren't open yet."} Joining early access is free and needs no card.</>],
        [
          "What happens when alerts open?",
          <>You get one email offering the {p.trialDays}-day free trial. Nothing is charged until you choose a plan ({p.priceSummary}).</>,
        ],
        ["What if you don't launch?", <>We&apos;ll tell you, and delete your address within 30 days.</>],
        ["Can I unsubscribe?", <>Yes, at any time: every email has a one-click unsubscribe link.</>],
      ];
  const quarterly = p.plans.find((x) => "perMonth" in x && x.perMonth);
  const trialLine = `Card required. $0 today. After the ${p.trialDays}-day free trial, ${quarterly?.price ?? ""} every 3 months or ${p.plans[0]?.price ?? ""} a month (the plan you choose), renewing automatically until you cancel. Cancel any time before the trial ends and you pay nothing.`;
  const freeFaq: [string, React.ReactNode][] = siteConfig.freeWeeklyEmail
    ? [
        [
          "What's in the free weekly email?",
          <>
            Every Monday, the past week&apos;s new vacancies that match one search you choose (keywords, organization, location), or the week&apos;s newest vacancies if you
            choose nothing. It lists up to 10, with a link to see the rest. If nothing new matches, we don&apos;t send it that week. No card or account is needed, and
            every email has a one-click unsubscribe. <Link href="/alerts" className="text-accent underline">Get the weekly email</Link>
          </>,
        ],
        [
          "What do paid alerts add?",
          <>New matches every day instead of once a week, and up to 5 saved searches instead of one. While you have a paid plan you get your alerts instead of the weekly email, not both.</>,
        ],
      ]
    : [];
  const faq: [string, React.ReactNode][] = [
    ...freeFaq,
    ...billingFaq,
    [
      siteConfig.freeWeeklyEmail ? "Will daily alerts email me every day?" : "Will I get an email every day?",
      <>Only when there is something new. If none of your searches has a new match, we don&apos;t send an email that day.</>,
    ],
    [
      "Where do the listings come from?",
      <>From public job feeds. Every listing links to the employer&apos;s own website, where you apply. We never charge anyone to apply for a job.</>,
    ],
    ["Are you part of the UN?", <>No. {siteConfig.name} is independent and not affiliated with the United Nations, the EU or any employer listed.</>],
  ];

  return (
    <>
      <PageHeader
        title="Email alerts"
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Email alerts" }]}
        intro={
          siteConfig.freeWeeklyEmail
            ? `Every vacancy, search and filter is free, and so is a weekly email for one search. Paid daily alerts${BILLING_LIVE ? "" : ", launching soon,"} bring new matches for up to 5 searches every day.`
            : `Every vacancy, search and filter is free. Paid email alerts${BILLING_LIVE ? "" : ", launching soon,"} bring new matches to your inbox so you don't have to keep checking.`
        }
      />
      <div className="mx-auto grid max-w-4xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-2">
        <section className="flex flex-col self-start rounded-2xl border border-rule p-7" aria-labelledby="plan-free">
          <h2 id="plan-free" className="text-2xl font-semibold leading-tight text-ink">Free</h2>
          <p className="mt-2"><span className="font-display text-4xl font-semibold text-ink">$0</span></p>
          <ul className="mt-6 space-y-3 text-ink">
            {["Browse and search every vacancy", "Filter by organization, country, category and deadline", "Add closing dates to your calendar", ...(siteConfig.freeWeeklyEmail ? ["Weekly email with new matches for one search"] : [])].map((f) => (
              <li key={f} className="flex gap-2.5"><Check />{f}</li>
            ))}
          </ul>
          <Link href={siteConfig.freeWeeklyEmail ? "/alerts" : "/jobs"} className="mt-8 rounded-lg border border-rule px-5 py-3 text-center font-semibold text-ink hover:bg-mist">
            {siteConfig.freeWeeklyEmail ? "Get the free weekly email" : "Browse jobs"}
          </Link>
        </section>

        <section className="flex flex-col rounded-2xl border-2 border-brand bg-candy-soft p-7" aria-labelledby="plan-premium">
          <div className="flex items-center justify-between gap-3">
            <h2 id="plan-premium" className="text-2xl font-semibold leading-tight text-ink">{siteConfig.freeWeeklyEmail ? "Daily alerts" : p.name}</h2>
            {BILLING_LIVE ? null : <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-ink">Launching soon</span>}
          </div>
          {/* Plain price text: the plan is chosen at the trial form, not here. */}
          <dl className="mt-3 space-y-3">
            {[...p.plans].reverse().map((plan) => (
              <div key={plan.label}>
                <dt className="text-sm font-medium text-ink">
                  {plan.label}
                  {plan.note ? (
                    <span className="mt-1 block w-fit rounded-full bg-remote-bg px-2 py-0.5 text-xs font-semibold text-remote sm:ml-2 sm:mt-0 sm:inline-block">Best value: {plan.note.toLowerCase()}</span>
                  ) : null}
                </dt>
                <dd className="mt-0.5 text-ink">
                  <span className="font-display text-3xl font-semibold">{plan.price}</span>{" "}
                  <span className="text-slate">{plan.per === "month" ? "a month" : `for ${plan.per}`}</span>
                  {"perMonth" in plan && plan.perMonth ? <span className="block text-sm text-slate">That&apos;s {plan.perMonth} a month.</span> : null}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="mt-6 flex-1 space-y-3 text-ink">
            {siteConfig.freeWeeklyEmail ? <li className="flex gap-2.5"><Check />Everything in Free, with alerts in place of the weekly email</li> : null}
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
          {BILLING_LIVE ? TAX_LINE : "Prices in US dollars."} {siteConfig.name} is run by {siteConfig.operator.name}.{" "}
          {BILLING_LIVE ? <><Link href="/refunds" className="text-accent underline">Refunds</Link> · </> : null}
          <Link href="/terms" className="text-accent underline">Terms</Link> · <Link href="/privacy" className="text-accent underline">Privacy</Link>
        </p>
      </section>
    </>
  );
}
