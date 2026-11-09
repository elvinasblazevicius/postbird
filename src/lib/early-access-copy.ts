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

/**
 * The line under the trial button, e.g. "Card required. $0 today, then $6.99/month
 * or $11.99 every 3 months unless you cancel before day 14. Cancel any time."
 */
export function trialLine() {
  const [m, q] = plans();
  return `Card required. $0 today, then ${m.price}/${m.per} or ${q.price} every ${q.per} unless you cancel before day ${siteConfig.premium.trialDays}. Cancel any time.`;
}

/** Plan choices for the checkout form; the 3-month plan (best value) comes first and is preselected. */
export function planOptions(): { value: "monthly" | "quarterly"; label: string; price: string; detail: string }[] {
  const [m, q] = plans();
  const perMonth = "perMonth" in q ? q.perMonth : null;
  return [
    {
      value: "quarterly",
      label: q.label,
      price: `${q.price} every ${q.per}`,
      detail: [perMonth ? `${perMonth}/month` : null, q.note || null].filter(Boolean).join(", "),
    },
    { value: "monthly", label: m.label, price: `${m.price}/${m.per}`, detail: m.note || "" },
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
