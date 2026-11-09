import siteConfig from "@site-config";

/** The line shown under every early-access button, so the offer reads the same everywhere. */
export function earlyAccessLine() {
  const p = siteConfig.premium;
  return `${p.name} launch soon: ${p.trialDays}-day free trial, then ${p.priceSummary}. No card, nothing charged now.`;
}

export const EARLY_ACCESS_BUTTON = "Get early access";

// ── Paid alerts (when billing is live) ───────────────────────
// Every price comes from siteConfig.premium.plans: plans[0] is monthly, plans[1] the 3-month plan.

const plans = () => siteConfig.premium.plans;

/** Button that opens the checkout, e.g. "Start 14-day free trial". */
export const trialButton = `Start ${siteConfig.premium.trialDays}-day free trial`;

/**
 * Tax wording wherever a price is shown with billing live. True whichever tax
 * mode the Paddle prices use (Paddle → Settings → Sales tax: prices
 * include tax, or tax is added at checkout): README section 6 says to check it.
 */
export const TAX_LINE = "Prices in US dollars. Depending on where you live, VAT or sales tax is included or added; Paddle shows the exact total before you pay.";

/** After a US-dollar amount in an email ("$19.99 every 3 months (VAT or sales tax included or added, depending on where you live)"). */
export const EMAIL_TAX_NOTE = "(VAT or sales tax included or added, depending on where you live)";

/** The words the trial line sets in bold. */
export const RENEWS = "renews automatically";

/**
 * The terms shown right above the trial button, for the plan that is selected:
 * "Card required. $0 today. Your free trial ends on 23 Nov 2026; then $19.99 every 3 months.
 * Your plan renews automatically until you cancel. Cancel any time before the trial ends and you pay nothing."
 * `trialEnds` is a formatted date, or null before the browser has worked it out.
 */
export function trialLine(plan: "monthly" | "quarterly" = "quarterly", trialEnds: string | null = null) {
  const [m, q] = plans();
  const price = plan === "monthly" ? `${m.price} a month` : `${q.price} every ${q.per}`;
  const when = trialEnds ? `Your free trial ends on ${trialEnds}` : `Your free trial lasts ${siteConfig.premium.trialDays} days`;
  return `Card required. $0 today. ${when}; then ${price}. Your plan ${RENEWS} until you cancel. Cancel any time before the trial ends and you pay nothing.`;
}

/** One free trial per email address (terms, pricing FAQ). */
export const ONE_TRIAL_RULE = "One free trial per email address. If you've had a trial before, your plan starts and is charged straight away.";

/** Under the button that starts a trial. */
export const TRIAL_CONSENT = "By starting the trial you agree to automatic renewal as described above.";
/** Under the button that starts a plan without a trial. */
export const NO_TRIAL_CONSENT = "By continuing you agree to automatic renewal as described above.";

/** The words the no-trial line sets in bold. */
export const RENEWING = "renewing automatically";

/** Button that opens the checkout for someone who has had a trial before (never promises a trial). */
export const noTrialButton = "Continue to payment";

/**
 * Replaces trialLine() once the server knows the address has had a trial before
 * (only after the visitor submitted it): the plan starts and is charged today.
 */
export function noTrialLine(plan: "monthly" | "quarterly" = "quarterly") {
  const [m, q] = plans();
  const price = plan === "monthly" ? `${m.price} a month` : `${q.price} every ${q.per}`;
  return `You've had a free trial before, so your plan starts today: ${price}, ${RENEWING} until you cancel.`;
}

/** Plan choices for the checkout form; the 3-month plan (best value) comes first and is preselected. */
export type PlanOption = {
  value: "monthly" | "quarterly";
  label: string;
  /** Full price charged each period, e.g. "$19.99". */
  price: string;
  /** "/ month" or "/ 3 months". */
  per: string;
  /** "= $6.66 a month" for longer plans. */
  perMonth: string | null;
  /** "Save 33%". */
  note: string | null;
  /** One short line under the price. */
  detail: string;
  best: boolean;
};

export function planOptions(): PlanOption[] {
  const [m, q] = plans();
  const perMonth = "perMonth" in q ? q.perMonth : null;
  return [
    {
      value: "quarterly",
      label: q.label,
      price: q.price,
      per: `/ ${q.per}`,
      perMonth: perMonth ? `= ${perMonth} a month` : null,
      note: q.note || null,
      detail: `Billed every ${q.per}`,
      best: true,
    },
    { value: "monthly", label: m.label, price: m.price, per: `/ ${m.per}`, perMonth: null, note: m.note || null, detail: "Billed monthly", best: false },
  ];
}

/** "Monthly ($9.99/month)" or "3 months ($19.99 every 3 months)" (prices from site.config.ts), for the account page and emails. */
export function planDescription(interval: "month" | "quarter" | null): string {
  const [m, q] = plans();
  if (interval === "quarter") return `${q.label} (${q.price} every ${q.per})`;
  if (interval === "month") return `${m.label} (${m.price}/${m.per})`;
  return siteConfig.premium.name;
}

/** The plan's price in US dollars as a number (for the admin's revenue estimate). */
export function planPriceNumber(interval: "month" | "quarter"): number {
  const p = interval === "quarter" ? plans()[1] : plans()[0];
  return Number(String(p.price).replace(/[^0-9.]/g, "")) || 0;
}
