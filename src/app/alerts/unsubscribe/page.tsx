import type { Metadata } from "next";
import { UnsubscribeForm } from "@/components/token-forms";
import { findByUnsubscribeToken } from "@/lib/subscribers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function UnsubscribePage({ searchParams }: Props) {
  const token = (await searchParams).token ?? "";
  const sub = await findByUnsubscribeToken(token);
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Unsubscribe</h1>
      {!sub ? (
        <p className="mt-3 text-lg text-slate">This unsubscribe link isn&apos;t valid. Use the link at the bottom of any of our emails.</p>
      ) : sub.status === "unsubscribed" ? (
        <p className="mt-3 text-lg text-slate"><strong className="text-ink">{sub.email}</strong> is already unsubscribed. We won&apos;t email you again.</p>
      ) : (
        <>
          <p className="mt-3 mb-6 text-lg text-slate">
            Stop all emails to <strong className="text-ink">{sub.email}</strong>?
          </p>
          <UnsubscribeForm token={token} />
        </>
      )}
    </div>
  );
}
