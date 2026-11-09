import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContinueCheckoutForm } from "@/components/paddle-checkout";
import { findCheckoutLink } from "@/lib/billing/checkout-links";
import { BILLING_LIVE } from "@/lib/billing/live";
import { ONE_TRIAL_RULE } from "@/lib/early-access-copy";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

// Private page (under /account: never indexed, cached or tracked). The token is in the address,
// so no referrer at all goes to Paddle's script server or anywhere else.
export const metadata: Metadata = { title: "Continue to daily alerts", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<{ token?: string | string[] }> };

/**
 * The single-use checkout link emailed to an address that has or had a plan
 * (see src/lib/billing/checkout-links.ts). Opening the page doesn't use the
 * link up (mail scanners open links); the button does.
 */
export default async function ContinuePage({ searchParams }: Props) {
  if (!BILLING_LIVE) notFound();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const link = await findCheckoutLink(token);
  const p = siteConfig.premium;

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Continue to daily alerts</h1>
      {!link ? (
        <p className="mt-3 text-lg text-slate">
          This link has already been used or has expired. Links work once, for 24 hours.{" "}
          <Link href="/pricing/trial" className="font-semibold text-accent underline">Start again</Link> and we&apos;ll email you a new one.
        </p>
      ) : link.state === "live" ? (
        <p className="mt-3 text-lg text-slate">
          <strong className="text-ink">{link.email}</strong> already has daily alerts, so there&apos;s nothing to buy. Open your account from the link in any of our
          emails, or <Link href="/account/login" className="font-semibold text-accent underline">get your account link</Link>.
        </p>
      ) : (
        <>
          <p className="mt-3 text-lg text-slate">
            For <strong className="text-ink">{link.email}</strong>: new vacancies matching your searches, by email, daily or weekly, with up to 5 searches.
            {link.state === "returning" ? ` ${ONE_TRIAL_RULE}` : ` ${p.trialDays} days free, then ${p.priceSummary}.`}
          </p>
          <div className="mt-8">
            <ContinueCheckoutForm token={token} trial={link.state === "new"} defaultPlan={link.plan} />
          </div>
        </>
      )}
    </div>
  );
}
