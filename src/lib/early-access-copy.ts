import siteConfig from "@site-config";

/** The line shown under every early-access button, so the offer reads the same everywhere. */
export function earlyAccessLine() {
  const p = siteConfig.premium;
  return `Email alerts launch soon: ${p.trialDays}-day free trial, then ${p.priceSummary}. No card, nothing charged now.`;
}

export const EARLY_ACCESS_BUTTON = "Get early access";
