import type { Metadata } from "next";
import { AccountLinkForm } from "@/components/account-forms";

export const metadata: Metadata = { title: "Your account link", robots: { index: false, follow: false } };

/** "Email me my account link": the account page has no password; its private link is emailed to the address. */
export default function AccountLoginPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Your account</h1>
      <p className="mb-6 mt-3 text-lg text-slate">
        There&apos;s no password. Enter the address you get alerts at and we&apos;ll email you a private link to your account.
      </p>
      <AccountLinkForm />
    </div>
  );
}
