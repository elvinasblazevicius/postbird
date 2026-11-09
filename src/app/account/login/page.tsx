import type { Metadata } from "next";
import Link from "next/link";
import { AccountLinkForm } from "@/components/account-forms";
import siteConfig from "@site-config";

export const metadata: Metadata = { title: "Manage or cancel your subscription", robots: { index: false, follow: false } };

/**
 * "Email me my account link": the account page has no password; its private link is emailed to the
 * address. Two ways in, one action: manage alerts, or cancel a plan (the same link, worded for it).
 */
export default function AccountLoginPage() {
  const privacy = (
    <p className="mt-3 text-sm text-slate">
      We use your address only to send these emails. <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">Privacy policy</Link>
    </p>
  );
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Manage or cancel your subscription</h1>
      <p className="mt-3 text-lg text-slate">
        There&apos;s no password. Enter the address you get emails at and we&apos;ll email you a private link to your account. Each new link replaces the old one.
      </p>

      <section aria-labelledby="manage-h" className="mt-8 rounded-xl border border-rule p-5 sm:p-6">
        <h2 id="manage-h" className="text-xl font-semibold text-ink">Change your searches or emails</h2>
        <p className="mb-4 mt-1 text-[0.95rem] text-slate">Add or remove saved searches, choose daily or weekly emails, or unsubscribe.</p>
        <AccountLinkForm />
        {privacy}
      </section>

      <section aria-labelledby="cancel-h" className="mt-6 rounded-xl border border-rule p-5 sm:p-6">
        <h2 id="cancel-h" className="text-xl font-semibold text-ink">Cancel my plan</h2>
        <p className="mb-4 mt-1 text-[0.95rem] text-slate">
          We&apos;ll email you the link to your account. Open it and choose &quot;Cancel or manage billing&quot;: Paddle, our reseller, shows the cancel option there. You
          keep alerts until the end of the period you&apos;ve paid for and aren&apos;t charged again.
        </p>
        <AccountLinkForm intent="cancel" />
        {privacy}
      </section>

      <p className="mt-6 text-sm leading-relaxed text-slate">
        You can also cancel from the link in Paddle&apos;s receipt email, or email us at{" "}
        <a href={`mailto:${siteConfig.contactEmail}`} className="text-accent underline">{siteConfig.contactEmail}</a> and we&apos;ll cancel it for you.
      </p>
    </div>
  );
}
