import type { Metadata } from "next";
import Link from "next/link";
import { AccountUnsubscribe, AddSearchForm, FrequencyForm, PortalButton, RemoveSearchButton, RestartPlanButton } from "@/components/account-forms";
import { ALL_CATEGORIES } from "@/config/categories";
import { COUNTRIES } from "@/config/countries";
import { GRADE_GROUPS, LANGUAGES, REGIONS } from "@/config/regions";
import { findByManageToken, type Account } from "@/lib/account";
import { BILLING_LIVE } from "@/lib/billing/live";
import { hadTrialBefore } from "@/lib/billing/subscriptions";
import { trialUsedElsewhere } from "@/lib/billing/trial-markers";
import { planDescription } from "@/lib/early-access-copy";
import { EXPERIENCE_BANDS, JOB_TYPES, organizationFacets } from "@/lib/jobs";
import { listSavedSearches, MAX_SAVED_SEARCHES, searchLimit } from "@/lib/saved-searches";
import { formatDate, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

// Private page: never indexed (the X-Robots-Tag header in next.config.ts says the same) and never tracked (see isPrivatePath).
// The account link (?t=) is in the address, so no referrer goes to any other site. The token stays in the
// address: the account forms refresh this page, which reads it from there.
export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { searchParams: Promise<{ t?: string | string[] }> };

const STATUS_TEXT: Record<Account["billing_status"], string> = {
  none: "No plan",
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  paused: "Paused",
  canceled: "Canceled",
};

function planLines(a: Account): string[] {
  const lines: string[] = [];
  if (a.billing_status === "trialing" && a.trial_ends_at) {
    lines.push(a.cancel_at ? `Your trial ends on ${formatDate(a.trial_ends_at)} and won't renew. Nothing more will be charged.` : `Your free trial ends on ${formatDate(a.trial_ends_at)}. Your first payment is taken then unless you cancel before.`);
  } else if (a.billing_status === "active" && a.current_period_end) {
    lines.push(a.cancel_at ? `Canceled: your plan stays on until ${formatDate(a.cancel_at)} and won't renew.` : `Renews on ${formatDate(a.current_period_end)}.`);
  } else if (a.billing_status === "past_due") {
    lines.push("Your last payment didn't go through, so alerts are on hold. Update your card under “Cancel or manage billing” to restart them.");
  } else if (a.billing_status === "paused") {
    lines.push("Your plan is paused, so alerts are on hold.");
  } else if (a.billing_status === "canceled") {
    lines.push(a.canceled_at ? `Your plan ended on ${formatDate(a.canceled_at)}. No more alerts are sent.` : "Your plan has ended. No more alerts are sent.");
  }
  return lines;
}

export default async function AccountPage({ searchParams }: Props) {
  const t = (await searchParams).t ?? "";
  const acct = await findByManageToken(t);
  if (!acct) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
        <h1 className="text-[2rem] font-semibold text-ink">Your account</h1>
        <p className="mt-3 text-lg text-slate">This account link isn&apos;t valid. Use the link in any of our emails, or ask for a new one.</p>
        <p className="mt-6">
          <Link href="/account/login" className="rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-accent">Email me my account link</Link>
        </p>
      </div>
    );
  }

  const searches = await listSavedSearches(acct.id);
  // One free trial per email address: only an address that never had a plan is offered it.
  const hadPlan = hadTrialBefore(acct, await trialUsedElsewhere(acct.email, acct.id));
  const alertsOn = acct.billing_status === "trialing" || acct.billing_status === "active";
  const paying = ["trialing", "active", "past_due", "paused"].includes(acct.billing_status);
  const limit = searchLimit(acct.billing_status);
  // Billing (Paddle's portal) once there is a Paddle customer or subscription; the customer is checked against this address before it opens.
  const billing = Boolean(acct.paddle_customer_id || acct.paddle_subscription_id);
  // The free weekly email goes only to confirmed addresses without a plan.
  const weekly = siteConfig.freeWeeklyEmail && !paying && acct.weekly_email && acct.status === "confirmed";
  const where = [
    { label: "Regions", options: REGIONS.map((r) => ({ value: `region-${r.slug}`, label: r.name })) },
    { label: "Countries", options: [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.slug, label: c.name })) },
  ];
  const card = "rounded-xl border border-rule bg-paper p-6";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-[2rem] font-semibold text-ink">Your account</h1>
      <p className="mt-1 text-slate">{acct.email}</p>

      <section className={`${card} mt-8`} aria-labelledby="plan-h">
        <h2 id="plan-h" className="text-lg font-semibold text-ink">{siteConfig.premium.name}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-[0.95rem] sm:grid-cols-[auto_1fr]">
          <dt className="text-slate">Plan</dt>
          <dd className="text-ink">{acct.billing_status === "none" ? "None yet" : planDescription(acct.plan_interval)}</dd>
          <dt className="text-slate">Status</dt>
          <dd className="font-semibold text-ink">{STATUS_TEXT[acct.billing_status]}</dd>
        </dl>
        {planLines(acct).map((l) => <p key={l} className="mt-3 text-[0.95rem] text-ink">{l}</p>)}
        {weekly ? (
          <p className="mt-3 text-[0.95rem] text-ink">
            You get the free weekly email on Mondays. A plan adds daily alerts and up to {MAX_SAVED_SEARCHES} searches, sent instead of the weekly email.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {billing ? <PortalButton t={acct.manage_token} /> : null}
          {!paying && BILLING_LIVE ? (
            hadPlan ? (
              <RestartPlanButton t={acct.manage_token} />
            ) : (
              <Link href="/pricing/trial" className="rounded-lg bg-brand px-5 py-2.5 text-[0.95rem] font-semibold text-white hover:bg-accent">
                Start your {siteConfig.premium.trialDays}-day free trial
              </Link>
            )
          ) : null}
        </div>
        {billing ? (
          <p className="mt-3 text-sm text-slate">Billing is handled by Paddle, our reseller: update your card, see invoices or cancel there.</p>
        ) : null}
      </section>

      <section className={`${card} mt-6`} aria-labelledby="searches-h">
        <h2 id="searches-h" className="text-lg font-semibold text-ink">Saved searches</h2>
        <p className="mt-1 text-[0.95rem] text-slate">
          {paying ? (
            <>
              Each alert lists the new vacancies matching these searches. Up to {MAX_SAVED_SEARCHES} searches.
              {alertsOn ? "" : " Alerts are sent only while your plan is in trial or active."}
            </>
          ) : weekly ? (
            <>
              Your free weekly email lists the past week&apos;s new matches for one search{searches.length > 1 ? " (the first one below)" : ""}. To follow a different
              search, remove this one and add another.
            </>
          ) : (
            <>
              Without a plan you can keep one saved search.
              {siteConfig.freeWeeklyEmail ? <> <Link href="/alerts" className="text-accent underline">Sign up for the free weekly email</Link> to get its new matches on Mondays.</> : null}
            </>
          )}
        </p>
        {searches.length ? (
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {searches.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={s.search ? `/jobs?${s.search}` : "/jobs"} className="font-medium text-accent hover:underline">{s.label || "All new vacancies"}</Link>
                  <div className="text-sm text-slate">{s.last_sent_at ? `Last alert ${formatDate(s.last_sent_at)}` : "No alert sent yet"}</div>
                </div>
                <RemoveSearchButton t={acct.manage_token} id={s.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg bg-signal-bg p-3 text-[0.95rem] text-ink">
            {weekly ? "You have no saved search, so your weekly email lists the week's newest vacancies. Add one below to narrow it." : "You have no saved searches, so no alerts are sent. Add one below."}
          </p>
        )}
        {searches.length < limit ? (
          <div className="mt-6">
            <h3 className="mb-3 font-semibold text-ink">Add a search</h3>
            <AddSearchForm
              t={acct.manage_token}
              where={where}
              categories={ALL_CATEGORIES.map((c) => ({ value: c.slug, label: c.name }))}
              grades={GRADE_GROUPS.map((g) => ({ value: g.value, label: g.name }))}
              types={JOB_TYPES.map((x) => ({ value: x, label: x }))}
              orgs={(await organizationFacets(500, false).catch(() => [])).map((o) => ({ value: o.slug, label: o.name }))}
              langs={LANGUAGES.map((l) => ({ value: l, label: l }))}
              exps={EXPERIENCE_BANDS.map((b) => ({ value: b.value, label: b.name }))}
            />
          </div>
        ) : null}
      </section>

      {paying ? (
        <section className={`${card} mt-6`} aria-labelledby="freq-h">
          <h2 id="freq-h" className="text-lg font-semibold text-ink">How often</h2>
          <p className="mb-3 mt-1 text-[0.95rem] text-slate">One email with all your matches, every day or once a week, with matching vacancies that close in the next 3 days. No email when there is nothing new and nothing closing.</p>
          <FrequencyForm t={acct.manage_token} current={acct.frequency} />
        </section>
      ) : null}

      <section className={`${card} mt-6`} aria-labelledby="unsub-h">
        <h2 id="unsub-h" className="text-lg font-semibold text-ink">Emails</h2>
        <div className="mt-2">
          <AccountUnsubscribe t={acct.manage_token} unsubscribed={acct.status === "unsubscribed"} paying={paying} />
        </div>
      </section>

      <p className="mt-8 text-sm text-slate">Keep this page&apos;s address private: anyone with it can change your alerts.</p>
    </div>
  );
}
