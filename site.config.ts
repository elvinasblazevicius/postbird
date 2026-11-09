/**
 * ─────────────────────────────────────────────────────────────
 *  BRAND & SITE SETTINGS — the one file to edit for branding.
 * ─────────────────────────────────────────────────────────────
 *  Change the name, wording, colours and contact details here.
 *  Everything on the site (pages, emails, metadata, structured
 *  data, admin) reads from this file. After editing, commit the
 *  change and Vercel redeploys automatically.
 */

const siteConfig = {
  /** Brand name shown in the header, page titles and emails. */
  name: "Postbird",
  /** Short name used where space is tight (browser tab, app icon). */
  shortName: "Postbird",
  /** What the site is, in a few words (header, page titles). */
  tagline: "UN, EU and international organization jobs in one place",
  /** One line describing the site (meta description default). */
  description:
    "Independent job search for UN, EU and international organization vacancies, each linked to the employer's own website.",

  /**
   * Public address of the site, without a trailing slash.
   * Leave empty until you buy a domain: the site then uses the
   * free Vercel address automatically (or NEXT_PUBLIC_SITE_URL
   * if you set it in Vercel's environment variables).
   */
  url: "https://postbird.nuevanova.com", // NEXT_PUBLIC_SITE_URL overrides this if set. Move to postbirdjobs.com if the concept test passes

  /** Address shown as the sender of alert emails (needs a verified domain in Resend). */
  emailFrom: "Postbird <alerts@nuevanova.com>",
  /** Public contact address shown in the footer and legal pages. Leave empty to hide. */
  contactEmail: "info@nuevanova.com",

  /**
   * Who runs the site. Shown in the footer, privacy policy, terms and email
   * footers (required by Microsoft Advertising, EU privacy law and US anti-spam law).
   */
  operator: {
    name: "Nueva Nova LLC",
    /** Shown on the terms and privacy pages next to the name. */
    legalForm: "a Wyoming limited liability company",
    address: "5830 E 2nd St, Ste 7000 #25426, Casper, Wyoming 82609, United States",
    /** Law that governs the terms of use. */
    governingLaw: "the State of Wyoming, United States",
  },

  /**
   * The total number of open vacancies is shown on the homepage only once it
   * reaches this number; below it the site shows a freshness line instead.
   */
  showVacancyCountFrom: 1000,

  /** Homepage wording. */
  home: {
    headline: "Jobs at the UN, EU and international organizations",
    subheadline:
      "Search the open vacancies we find at UN agencies, EU institutions and other international organizations, with the closing date whenever the employer publishes one.",
    /**
     * Used instead of the lines above (and of `tagline` on the homepage) while no EU institution
     * has an open vacancy on the site, so the site never promises EU jobs it doesn't list.
     */
    withoutEu: {
      headline: "Jobs at the UN and international organizations",
      subheadline:
        "Search the open vacancies we find at UN agencies and other international organizations, with the closing date whenever the employer publishes one.",
      tagline: "UN and international organization jobs in one place",
      /** Also the default meta and share description on every page (see src/lib/eu-claim.ts). */
      description: "Independent job search for UN and international organization vacancies, each linked to the employer's own website.",
    },
  },

  /**
   * Paid email alerts shown on /pricing. Real billing (Paddle) switches on when
   * the Paddle env vars are set (src/lib/billing/live.ts); until then the
   * sign-up boxes collect early-access emails and say nothing is charged.
   * Prices here must match the Paddle prices; plans[0] is monthly, plans[1] 3 months.
   */
  /**
   * Email alerts. true = a free weekly email (Mondays) with the new matches for
   * one saved search, with paid daily alerts (up to 5 searches) as the upgrade.
   * false = alerts are only part of the paid plan (every sign-up box offers the
   * free trial).
   */
  freeWeeklyEmail: true,

  /**
   * Concept test (decided 9 Nov 2026, before any ad spend). Measured on visitors
   * who arrive from ads (Microsoft Ads auto-tagging or utm_ parameters):
   * share who click "Start free trial" AND leave their email.
   * Passed at or above successRate, failed below failRate, with at least
   * minVisitors ad visitors. Admin → Overview shows the verdict.
   */
  conceptTest: { successRate: 0.03, failRate: 0.01, minVisitors: 300 },

  premium: {
    /**
     * The paid plan's name. "Email alerts" is only the umbrella (the /alerts page and
     * its menu label), which offers both the free weekly email and daily alerts.
     */
    name: "Daily alerts",
    trialDays: 14,
    /** Shown on /pricing; the first plan is the headline price. */
    plans: [
      // Monthly is priced higher on purpose: the 3-month plan brings more money in up front, which is what pays for ads.
      { label: "Monthly", price: "$9.99", per: "month", note: "" },
      { label: "3 months", price: "$19.99", per: "3 months", note: "Save 33%", perMonth: "$6.66" },
    ],
    /** Short version used in sign-up boxes. */
    priceSummary: "$9.99/month or $19.99 for 3 months",
    /**
     * What the paid plan adds, and only that: the free weekly email (one search) has the same
     * filters, closing dates and links. Most distinctive first: the first line is the "Closing in
     * the next 3 days" section of paid alerts (CLOSING_SOON_DAYS in src/lib/email-templates.ts);
     * alerts honour each search's filters, "Hide local-only posts" included (filterConditions in
     * src/lib/jobs.ts). The last line assumes freeWeeklyEmail is on.
     */
    features: [
      "A reminder of matching vacancies that close in the next 3 days (when the employer publishes a closing date)",
      "Up to 5 searches instead of one, with the same filters",
      "New matches every day, up to 6 days before the weekly email",
    ],
  },

  /**
   * Colours. `brand` is the main blue (buttons, hero), `accent` the darker
   * blue for links and hover states, `sky` the light end of the hero
   * gradient, `candy` the pink used for "closing soon", `highlight` the
   * yellow of the main call-to-action buttons, `ink` the text colour.
   */
  colors: {
    brand: "#1F4FD1",
    accent: "#173FAE",
    sky: "#38C6FF",
    /** Deadline red: closing-soon labels only. */
    candy: "#B42318",
    /** Sunshine yellow for the main "Get email alerts" buttons. */
    highlight: "#FFD23F",
    ink: "#0E1F3D",
  },

  /**
   * Legal line shown in the footer. Keep a non-affiliation notice:
   * the site lists vacancies from these organizations but is not run by them.
   */
  disclaimer:
    "Postbird is an independent job discovery site. It is not affiliated with, endorsed by or acting for the United Nations or any organization listed. Applications are made only through each employer's own website or application form.",

  /** Optional social links shown in the footer. Leave empty to hide. */
  social: {
    linkedin: "",
    x: "",
  },
} as const;

export default siteConfig;
export type SiteConfig = typeof siteConfig;
