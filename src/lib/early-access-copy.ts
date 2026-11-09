import siteConfig from "@site-config";

/** The line shown under every early-access button, so the offer reads the same everywhere. */
export function earlyAccessLine() {
  const p = siteConfig.premium;
  return `Email alerts launch soon: ${p.trialDays}-day free trial, then ${p.priceSummary}. No card, nothing charged now.`;
}

export const EARLY_ACCESS_BUTTON = "Get early access";

// ── Paid alerts (when billing is live) ───────────────────────
// Every price comes from siteConfig.premium.plans: plans[0] is monthly, plans[1] the 3-month plan.

const plans = () => siteConfig.premium.plans;

/** Button that opens the checkout, e.g. "Start 14-day free trial". */
export const trialButton = `Start ${siteConfig.premium.trialDays}-day free trial`;

/** Tax wording wherever a price is shown with billing live (Paddle adds tax at checkout where it applies). */
export const TAX_LINE = "Prices in US dollars and include VAT where it applies. US and Canadian sales tax may be added at checkout.";

/** After a US-dollar amount in an email ("$19.99 every 3 months (plus any sales tax shown at checkout)"). */
export const EMAIL_TAX_NOTE = "(plus any sales tax shown at checkout)";

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

/** "Monthly ($6.99/month)" or "3 months ($11.99 every 3 months)", for the account page and emails. */
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
