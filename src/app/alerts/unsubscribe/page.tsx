import type { Metadata } from "next";
import { StripUrlToken } from "@/components/strip-url-token";
import { CancelPlanForm, UnsubscribeForm } from "@/components/token-forms";
import { planRenewal } from "@/lib/billing/notices";
import { findByUnsubscribeToken } from "@/lib/subscribers";

export const dynamic = "force-dynamic";
// The token is in the address: no referrer at all goes to any other site, and the token is taken
// out of the address bar once the page has loaded (the forms carry it).
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false }, referrer: "no-referrer" };

const TOKEN_PARAMS = ["token"];

type Props = { searchParams: Promise<{ token?: string | string[] }> };

export default async function UnsubscribePage({ searchParams }: Props) {
  const raw = (await searchParams).token;
  // A repeated parameter arrives as an array; findByUnsubscribeToken accepts only a well-formed token.
  const token = typeof raw === "string" ? raw : "";
  const sub = await findByUnsubscribeToken(token);
  // A running plan (trial, paying, payment overdue or paused): unsubscribing stops emails, not the plan.
  const renewal = sub ? planRenewal(sub) : null;
  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <StripUrlToken params={TOKEN_PARAMS} />
      <h1 className="text-[2rem] font-semibold text-ink">Unsubscribe</h1>
      {!sub ? (
        <p className="mt-3 text-lg text-slate">This unsubscribe link isn&apos;t valid. Use the link at the bottom of any of our emails.</p>
      ) : renewal ? (
        <>
          <p className="mt-3 text-lg text-slate">
            {sub.status === "unsubscribed"
              ? <><strong className="text-ink">{sub.email}</strong> is already unsubscribed from alerts.</>
              : <>Unsubscribing <strong className="text-ink">{sub.email}</strong> stops our alert emails only.</>}
            {renewal.canCancel ? " It does not cancel your plan." : ""}
          </p>
          <p className="mt-3 rounded-xl bg-signal-bg p-4 text-[1.02rem] leading-relaxed text-ink">{renewal.sentence}</p>
          {renewal.chargesAhead ? (
            <p className="mt-3 text-[0.95rem] text-slate">
              To stop payments, cancel the plan: &quot;Cancel my plan&quot; emails you a link to your account, where you cancel it. You&apos;ll still get emails about the
              plan itself, such as a reminder before a free trial ends, and Paddle&apos;s receipts.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-start gap-3">
            {renewal.canCancel ? <CancelPlanForm token={token} /> : null}
            {sub.status === "unsubscribed" ? null : <UnsubscribeForm token={token} label={renewal.canCancel ? "Just stop emails" : "Unsubscribe"} secondary={renewal.canCancel} />}
          </div>
        </>
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
