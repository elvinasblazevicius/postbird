import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RefundPolicyText } from "@/components/refund-policy";
import { BILLING_LIVE } from "@/lib/billing/live";
import { ONE_TRIAL_RULE, UNCONFIRMED_CANCEL_DAYS } from "@/lib/early-access-copy";
import { siteConfig } from "@/lib/site";

/**
 * Built at deploy without the database, so the header and footer list only the employer types that
 * always have vacancies; rendered again at most hourly after that, with the real counts (employerNav
 * in src/components/site-header.tsx).
 */
export const revalidate = 3600;

export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  const op = siteConfig.operator;
  const p = siteConfig.premium;
  const mail = siteConfig.contactEmail;
  return (
    <>
      <PageHeader width="max-w-3xl" title="Terms of use" crumbs={[{ href: "/", label: "Home" }, { href: "/terms", label: "Terms" }]} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        <p className="text-sm text-slate">Last updated 9 November 2026</p>
        <p>
          {siteConfig.name} is run by {op.name}, {op.legalForm}, {op.address}
          {mail ? <> (<a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a>)</> : null}. By using the site you agree to these terms.
        </p>
        <p>{siteConfig.disclaimer}</p>

        <h2 className="pt-2 text-xl font-semibold">Listings</h2>
        <p>
          Vacancy information is collected automatically from public job feeds and may be incomplete, out of date or changed by the employer. Details a posting doesn&apos;t give
          are left out, never guessed. Always check the employer&apos;s own posting, including the closing date, before applying. Vacancy content remains the property
          of the organizations that publish it.
        </p>

        <h2 className="pt-2 text-xl font-semibold">No recruitment services</h2>
        <p>We don&apos;t recruit, accept applications or act for any employer. We never ask job seekers for payment to apply for a job.</p>

        <h2 id="service" className="scroll-mt-24 pt-2 text-xl font-semibold">What the emails include</h2>
        <p>
          Alerts include the vacancies our sources publish. We can&apos;t guarantee that every vacancy at an organization will be included or that an email arrives
          on a particular day.
          {BILLING_LIVE ? (
            <>
              {" "}If alerts stop working for more than 7 days, email us{mail ? <> at <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a></> : null} for
              a pro-rata refund.
            </>
          ) : null}
        </p>

        <h2 id="acceptable-use" className="scroll-mt-24 pt-2 text-xl font-semibold">Acceptable use</h2>
        <p>
          Use the site and the emails for your own job search. Don&apos;t scrape or copy listings in bulk, resell or republish them, overload or attack the site, or
          sign up other people without their permission.
        </p>
        <p>
          We may suspend or close access, including a subscription, that breaks these terms. If we do, we&apos;ll tell you why by email. If we close a paid plan
          for a breach, we refund the unused part of the period.
        </p>

        {siteConfig.freeWeeklyEmail ? (
          <>
            <h2 id="weekly-email" className="scroll-mt-24 pt-2 text-xl font-semibold">Free weekly email</h2>
            <p>
              The weekly email is free and needs no card or account. It comes on Mondays (or, if a Monday send fails, later that week) and lists the past
              week&apos;s new vacancies that match the one search you chose,
              or the week&apos;s newest vacancies if you chose none. If nothing new matches, we don&apos;t send it that week. It starts once you confirm your address,
              and every email has a one-click unsubscribe link. It may include one short line about paid daily alerts. While you have a paid plan you get your alerts
              instead of the weekly email. We may change or stop the free email; if we stop it, we&apos;ll tell subscribers first.
            </p>
          </>
        ) : null}

        <h2 className="pt-2 text-xl font-semibold">{siteConfig.freeWeeklyEmail ? "Paid daily alerts" : "Email alerts"}</h2>
        {BILLING_LIVE ? (
          <>
            <p>
              {p.name} are a paid subscription: {p.priceSummary}. Our order process is conducted by our online reseller Paddle.com, which is the merchant of
              record for all orders and handles payment, invoices, sales tax and VAT. Paddle&apos;s{" "}
              <a className="text-accent underline" href="https://www.paddle.com/legal/checkout-buyer-terms" rel="noopener">buyer terms</a> also apply to your purchase.
            </p>
            <h3 id="subscriptions" className="scroll-mt-24 pt-1 text-lg font-semibold">Subscriptions</h3>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>Free trial:</strong> new subscriptions start with a {p.trialDays}-day free trial. A card is required. If you don&apos;t cancel before the trial
                ends, the plan you chose starts and you are charged automatically. We email you a reminder about 3 days before the trial ends.{" "}
                {ONE_TRIAL_RULE}
              </li>
              <li>
                <strong>Confirming your email address:</strong> a trial started from our sign-up form starts your alerts only once you confirm your email address
                with the link we send you. If you don&apos;t confirm it at least {UNCONFIRMED_CANCEL_DAYS} days before the trial ends, we cancel the trial and you
                aren&apos;t charged. Until you confirm, we send the confirmation link again instead of the trial reminder.
              </li>
              <li><strong>Renewal:</strong> plans renew automatically at the end of each period (every month or every 3 months) until you cancel.</li>
              <li>
                <strong>Failed payments:</strong> if a payment fails, Paddle retries it and alerts pause until it goes through; you can update your card from your
                account.
              </li>
            </ul>
            <h3 id="cancel" className="scroll-mt-24 pt-1 text-lg font-semibold">Cancelling</h3>
            <p>
              Cancel any time: open your account (the link is in every alert email, or{" "}
              <a className="text-accent underline" href="/account/login">get your account link by email</a>) and choose &quot;Cancel plan&quot;. You can also
              cancel from the link in Paddle&apos;s receipt email
              {mail ? <>, or email us at <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a> and we&apos;ll cancel it for you</> : null}. Your alerts continue until the end of the period you have paid for, and you are not charged again.
              Unsubscribing from our emails does not cancel your plan.
            </p>
            <h3 id="refunds" className="scroll-mt-24 pt-1 text-lg font-semibold">Refunds</h3>
            <RefundPolicyText />
            <p>The same policy is on our <Link href="/refunds" className="text-accent underline">refunds page</Link>.</p>
            <h3 className="pt-1 text-lg font-semibold">Price changes</h3>
            <p>We&apos;ll email you at least 30 days before any price change takes effect, so you can cancel first.</p>
            <h3 className="pt-1 text-lg font-semibold">If we stop offering daily alerts</h3>
            <p>If we stop offering daily alerts, we&apos;ll tell you at least 30 days ahead, cancel your plan and refund the unused part of any period you&apos;ve paid for.</p>
          </>
        ) : (
          <p>
            Paid daily alerts are not open yet; we are measuring interest first. Joining early access is free and creates no obligation. When alerts open they will cost{" "}
            {p.priceSummary}, with a {p.trialDays}-day free trial. We will publish the full billing terms here before taking any payment.
          </p>
        )}

        <h2 id="age" className="scroll-mt-24 pt-2 text-xl font-semibold">Age</h2>
        <p>
          {siteConfig.name} is meant for adults looking for work. You must be at least 16 to sign up for our emails, and at least 18 to buy a subscription.
        </p>

        <h2 className="pt-2 text-xl font-semibold">Liability</h2>
        <p>
          The site is provided as is. To the extent the law allows, {op.name} is not liable for losses arising from errors in listings, missed deadlines or decisions made
          by employers. Nothing in these terms limits rights you have under consumer law where you live.
        </p>

        <h2 className="pt-2 text-xl font-semibold">Corrections and removal</h2>
        <p>
          Organizations that want a listing corrected or removed, and anyone who spots an error, can contact us{mail ? <> at <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a></> : null}.
          We act on removal requests within five working days.
        </p>

        <h2 id="changes" className="scroll-mt-24 pt-2 text-xl font-semibold">Changes to these terms</h2>
        <p>
          We may update these terms; the date at the top shows when they last changed. Before a material change takes effect, we&apos;ll email subscribers
          to say what is changing.
        </p>

        <h2 className="pt-2 text-xl font-semibold">Governing law</h2>
        <p>These terms are governed by the law of {op.governingLaw}, without affecting mandatory consumer protections in your country.</p>
      </div>
    </>
  );
}
