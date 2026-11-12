import type { Metadata } from "next";
import Link from "next/link";
import { StripUrlToken } from "@/components/strip-url-token";
import { ConfirmForm } from "@/components/token-forms";
import { findByConfirmToken } from "@/lib/subscribers";

export const dynamic = "force-dynamic";
// The token is in the address: no referrer at all goes to any other site, and the token is taken
// out of the address bar once the page has loaded (the forms carry it).
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false }, referrer: "no-referrer" };

const TOKEN_PARAMS = ["token"];

type Props = { searchParams: Promise<{ token?: string | string[] }> };

export default async function ConfirmPage({ searchParams }: Props) {
  const raw = (await searchParams).token;
  // A repeated parameter arrives as an array; findByConfirmToken accepts only a well-formed token.
  const token = typeof raw === "string" ? raw : "";
  const sub = token ? await findByConfirmToken(token) : null;
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <StripUrlToken params={TOKEN_PARAMS} />
      {/* With a valid link the form shows the heading itself: it changes once the address is confirmed. */}
      {sub ? null : <h1 className="text-[2rem] font-semibold text-ink">Confirm your email</h1>}
      {sub ? (
        <ConfirmForm token={token} email={sub.email} />
      ) : !token ? (
        <p className="mt-3 text-lg text-slate">
          Open the link in the confirmation email we sent you to finish signing up. Didn&apos;t get it? Check your spam folder or{" "}
          <Link href="/alerts" className="text-accent underline">sign up again</Link>.
        </p>
      ) : (
        <p className="mt-3 text-lg text-slate">
          This confirmation link has already been used or is no longer valid. If you&apos;re not receiving our emails,{" "}
          <Link href="/alerts" className="text-accent underline">sign up again</Link>.
        </p>
      )}
    </div>
  );
}
