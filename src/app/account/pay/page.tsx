import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaddlePaymentLink } from "@/components/paddle-checkout";
import { BILLING_LIVE } from "@/lib/billing/live";

export const metadata: Metadata = { title: "Secure checkout", robots: { index: false, follow: false } };

/**
 * Paddle's "default payment link" (set in Paddle > Checkout > Checkout
 * configuration): Paddle sends customers here with ?_ptxn=<transaction> to
 * pay or to update their card, and Paddle.js opens that checkout by itself.
 */
export default function PayPage() {
  if (!BILLING_LIVE) notFound();
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Secure checkout</h1>
      <div className="mt-4 text-lg">
        <PaddlePaymentLink />
      </div>
    </div>
  );
}
