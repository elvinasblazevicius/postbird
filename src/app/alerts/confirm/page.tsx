import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmForm } from "@/components/token-forms";
import { findByConfirmToken } from "@/lib/subscribers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ConfirmPage({ searchParams }: Props) {
  const token = (await searchParams).token ?? "";
  const sub = token ? await findByConfirmToken(token) : null;
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Confirm your email</h1>
      {sub ? (
        <>
          <p className="mt-3 mb-6 text-lg text-slate">
            Confirm that <strong className="text-ink">{sub.email}</strong> should receive our emails.
          </p>
          <ConfirmForm token={token} />
        </>
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
