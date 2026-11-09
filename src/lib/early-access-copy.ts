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
/**
 * What a card statement shows for a Paddle charge: "PADDLE.NET*" and the seller name set in
 * Paddle's checkout settings (Paddle help, "What will customers see on their statement?", checked
 * 9 November 2026). Used on /pricing and in the welcome email.
 */
export const CARD_STATEMENT_LINE = "Your card statement will show PADDLE.NET* NUEVANOVA.";
export const EMAIL_TAX_NOTE = "(VAT or sales tax included or added, depending on where you live)";

/** The words the trial line sets in bold. */
export const RENEWS = "renews automatically";

/**
 * The one summary line above the trial checkbox, for the plan that is selected:
 * "$0 today · trial ends 23 November 2026 · then $19.99 every 3 months until you cancel".
 * `trialEnds` is a formatted date, or null before the browser has worked it out.
 */
export function trialSummary(plan: "monthly" | "quarterly" = "quarterly", trialEnds: string | null = null) {
  const [m, q] = plans();
  const price = plan === "monthly" ? `${m.price} every ${m.per}` : `${q.price} every ${q.per}`;
  const when = trialEnds ? `trial ends ${trialEnds}` : `${siteConfig.premium.trialDays}-day free trial`;
  return `$0 today · ${when} · then ${price} until you cancel`;
}

/**
 * Under the summary, always visible (the facts the law wants in view before a trial starts): the
 * card, the automatic renewal and how not to pay. Tax, address confirmation and the one-trial
 * rule fold into a "Details" disclosure.
 */
export const TRIAL_TERMS = `Card required. Your plan ${RENEWS} until you cancel. Cancel any time before the trial ends and you pay nothing.`;

/**
 * A trial started from the public form at an address nobody has confirmed is canceled once it
 * ends within this many days (the daily job, runBillingSafety), so nothing is charged. The
 * address must be confirmed before then: the terms, the checkout and the confirmation email say so.
 */
export const UNCONFIRMED_CANCEL_DAYS = 2;
/** How many days a trial gives to confirm the address (the trial length minus UNCONFIRMED_CANCEL_DAYS). */
export const CONFIRM_WITHIN_DAYS = siteConfig.premium.trialDays - UNCONFIRMED_CANCEL_DAYS;

/** After checkout from the public form: the trial runs, and the address must be confirmed. */
export const CONFIRM_FIRST_DONE = `Confirm your address within ${CONFIRM_WITHIN_DAYS} days to start your alerts; if you don't, we cancel the trial and you pay nothing.`;

/** One free trial per email address (terms, pricing FAQ). */
export const ONE_TRIAL_RULE = "One free trial per email address, counting forms like name+tag@ and dotted Gmail addresses as the same address. If you've had a trial before, your plan starts and is charged straight away.";

/**
 * In the visible terms above the "renews automatically" checkbox on the public trial form, where
 * the address isn't proven yet (the pricing FAQ says the same). Not on the emailed continue page:
 * opening that link already confirmed the address.
 */
export const TRIAL_CONFIRM_NOTE = `Your ${siteConfig.premium.trialDays} days start today. We'll email you a link to confirm your address; your alerts start once you confirm.`;

/** In the trial form's "Details", with tax and the card statement line. */
export const ONE_TRIAL_SHORT = "One free trial per email address.";

/** First in the box shown after a trial checkout on the public form. */
export const CHECK_INBOX_FIRST = "Check your inbox now to confirm your address and start your alerts.";

/**
 * The checkbox that must be ticked before a trial checkout opens. It states the consent itself, so
 * no separate "By starting the trial you agree…" sentence repeats it.
 */
export const TRIAL_RENEWAL_ACK = "I agree that my plan renews automatically after the trial until I cancel.";
/** The same checkbox before a plan without a trial. */
export const NO_TRIAL_RENEWAL_ACK = "I agree that my plan renews automatically until I cancel.";

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
