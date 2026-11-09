import { siteConfig } from "@/lib/site";

/** The refund policy, word for word the same on /refunds and in the terms (/terms#refunds). */
export function RefundPolicyText() {
  const mail = siteConfig.contactEmail;
  return (
    <>
      <p>
        Changed your mind? Email {mail ? <a className="text-accent underline" href={`mailto:${mail}`}>{mail}</a> : "us"} within 14 days of any charge — the first
        charge after your trial or any renewal — and we&apos;ll refund that charge in full, no questions asked. Refunds are issued by Paddle to your original payment
        method, usually within 5–10 days.
      </p>
      <p>When we refund a charge, we also cancel your plan and alerts stop, unless you ask us to keep it running.</p>
      <p>
        Customers in the EU and UK also have the statutory right to withdraw set out in Paddle&apos;s{" "}
        <a className="text-accent underline" href="https://www.paddle.com/legal/checkout-buyer-terms" rel="noopener">buyer terms</a>. Nothing here limits rights you
        have under consumer law where you live.
      </p>
    </>
  );
}
