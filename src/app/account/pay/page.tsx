import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoCheckoutHere, PaddlePaymentLink } from "@/components/paddle-checkout";
import { BILLING_LIVE } from "@/lib/billing/live";

// The address carries Paddle's transaction id (?_ptxn=), which Paddle.js reads from it, so it stays; no referrer goes elsewhere.
export const metadata: Metadata = { title: "Secure checkout", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Paddle's "default payment link" (set in Paddle > Checkout > Checkout
 * configuration): Paddle sends customers here with ?_ptxn=<transaction> to
 * pay or to update their card, and Paddle.js opens that checkout by itself.
 * Without _ptxn there is nothing to open, so the page says where to go instead.
 */
export default async function PayPage({ searchParams }: Props) {
  if (!BILLING_LIVE) notFound();
  const ptxn = (await searchParams)._ptxn;
  const hasTransaction = typeof ptxn === "string" && /^txn_[a-z0-9]{10,}$/i.test(ptxn);
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Secure checkout</h1>
      <div className="mt-4 text-lg">{hasTransaction ? <PaddlePaymentLink /> : <NoCheckoutHere />}</div>
    </div>
  );
}
