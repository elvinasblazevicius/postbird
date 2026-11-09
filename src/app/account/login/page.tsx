import type { Metadata } from "next";
import { AccountLinkForm } from "@/components/account-forms";
import siteConfig from "@site-config";

export const metadata: Metadata = { title: "Manage or cancel your subscription", robots: { index: false, follow: false } };

/** "Email me my account link": the account page has no password; its private link is emailed to the address. */
export default function AccountLoginPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Manage or cancel your subscription</h1>
      <p className="mb-6 mt-3 text-lg text-slate">
        There&apos;s no password. Enter the address you get alerts at and we&apos;ll email you a private link to your account. There you can change your
        searches, or choose &quot;Manage billing or cancel&quot; to cancel your plan.
      </p>
      <AccountLinkForm />
      <p className="mt-6 text-sm leading-relaxed text-slate">
        You can also cancel from the link in Paddle&apos;s receipt email, or email us at{" "}
        <a href={`mailto:${siteConfig.contactEmail}`} className="text-accent underline">{siteConfig.contactEmail}</a> and we&apos;ll cancel it for you.
      </p>
    </div>
  );
}
