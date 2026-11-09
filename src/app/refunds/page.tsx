import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RefundPolicyText } from "@/components/refund-policy";
import { BILLING_LIVE } from "@/lib/billing/live";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refunds",
  description: `${siteConfig.name} refund policy for email alerts: a full refund of any charge if you ask within 14 days.`,
  alternates: { canonical: "/refunds" },
};

export default function RefundsPage() {
  return (
    <>
      <PageHeader width="max-w-3xl" title="Refunds" crumbs={[{ href: "/", label: "Home" }, { href: "/refunds", label: "Refunds" }]} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-12 text-[1.02rem] leading-relaxed text-ink sm:px-6">
        {BILLING_LIVE ? null : (
          <p className="rounded-xl bg-mist px-4 py-3">
            Paid email alerts aren&apos;t open yet and nothing is charged. This policy will apply once they are.
          </p>
        )}
        <RefundPolicyText />
        <p>
          To stop future charges, cancel from your account page (see <Link href="/terms#cancel" className="text-accent underline">Cancelling</Link>). Cancelling
          doesn&apos;t refund a charge by itself; to get one back, email us as above.
        </p>
        <p className="text-sm text-slate">
          {siteConfig.name} is run by {siteConfig.operator.name}. Payments are handled by Paddle.com, our merchant of record. Full terms:{" "}
          <Link href="/terms" className="text-accent underline">Terms of use</Link>.
        </p>
      </div>
    </>
  );
}
