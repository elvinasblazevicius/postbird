import type { Metadata } from "next";
import Link from "next/link";
import { AccountLinkForm } from "@/components/account-forms";
import siteConfig from "@site-config";

/**
 * Built at deploy without the database, so the header and footer list only the employer types that
 * always have vacancies; rendered again at most hourly after that, with the real counts (employerNav
 * in src/components/site-header.tsx).
 */
export const revalidate = 3600;

export const metadata: Metadata = { title: "Sign in: manage or cancel your alerts", robots: { index: false, follow: false } };

/**
 * "Email me my account link": the account page has no password; its private link is emailed to the
 * address. Two ways in, one action: manage alerts, or cancel a plan (the same link, worded for it).
 */
export default function AccountLoginPage() {
  const privacy = (
    <p className="mt-3 text-sm text-slate">
      We use your address to send these emails and never sell it. <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">Privacy policy</Link>
    </p>
  );
  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6 sm:py-20">
      <h1 className="text-[2rem] font-semibold text-ink">Sign in</h1>
      <p className="mt-3 text-lg text-slate">
        There&apos;s no password: enter the address you get our emails at and we&apos;ll email you a private link to your account, where you change your searches, switch
        between daily and weekly emails, or unsubscribe.
      </p>

      <section aria-label="Email me my account link" className="mt-6 rounded-xl border border-rule p-5 sm:p-6">
        <AccountLinkForm />
        {privacy}
      </section>

      <details className="group mt-5 rounded-xl border border-rule">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold text-ink hover:bg-mist [&::-webkit-details-marker]:hidden">
          Want to cancel your plan?
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-slate transition-transform group-open:rotate-180" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
        </summary>
        <div className="border-t border-rule px-5 pb-5 pt-4">
          <p className="mb-4 text-[0.95rem] text-slate">
            We&apos;ll email you the link to your account. Open it and choose &quot;Cancel plan&quot;: it opens the cancel page of Paddle, our reseller. You
            keep alerts until the end of the period you&apos;ve paid for and aren&apos;t charged again.
          </p>
          <AccountLinkForm intent="cancel" />
          <p className="mt-4 text-sm leading-relaxed text-slate">
            You can also cancel from the link in Paddle&apos;s receipt email, or email us at{" "}
            <a href={`mailto:${siteConfig.contactEmail}`} className="text-accent underline">{siteConfig.contactEmail}</a> and we&apos;ll cancel it for you.
          </p>
        </div>
      </details>

      <p className="mt-6 text-[0.95rem] text-ink">
        Not signed up yet? <Link href="/alerts" className="font-semibold text-accent underline underline-offset-2">Get job alerts</Link>
      </p>
    </div>
  );
}
