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
  name: "Global Careers Hub",
  /** Short name used where space is tight (browser tab, app icon). */
  shortName: "GCH",
  /** What the site is, in a few words (header, page titles). */
  tagline: "UN and international organization job aggregator",
  /** One line describing the site (meta description default). */
  description:
    "The UN and international organization job aggregator: vacancies from UN agencies, development banks, EU institutions and other international organizations in one place, linked straight to the official application pages.",

  /**
   * Public address of the site, without a trailing slash.
   * Leave empty until you buy a domain: the site then uses the
   * free Vercel address automatically (or NEXT_PUBLIC_SITE_URL
   * if you set it in Vercel's environment variables).
   */
  url: "",

  /** Address shown as the sender of alert emails (needs a verified domain in Resend). */
  emailFrom: "Global Careers Hub <alerts@example.com>",
  /** Public contact address shown in the footer and legal pages. Leave empty to hide. */
  contactEmail: "",

  /** Homepage wording. */
  home: {
    headline: "Discover Your Next International Career",
    subheadline:
      "UN and international organization jobs in one place. Search in seconds, or let email alerts bring new vacancies straight to your inbox.",
  },

  /**
   * Premium plan shown on /pricing. Billing is NOT switched on yet: the
   * "Start free trial" button records interest (a "fake door" test) and
   * tells visitors honestly that Premium opens soon. Change the price
   * here to test different price points.
   */
  /**
   * Email alerts. false = alerts are part of the paid plan (every sign-up box
   * offers the free trial). true = a free weekly email for everyone, with
   * Premium as the paid upgrade.
   */
  freeWeeklyEmail: false,

  premium: {
    name: "Email alerts",
    trialDays: 14,
    /** Shown on /pricing; the first plan is the headline price. */
    plans: [
      { label: "Monthly", price: "$5", per: "month", note: "" },
      { label: "3 months", price: "$12", per: "3 months", note: "Save 20%" },
    ],
    /** Short version used in sign-up boxes. */
    priceSummary: "$5/month or $12 for 3 months",
    features: [
      "New vacancies by email, daily or weekly",
      "Filtered by keyword, organization and location",
      "Deadline reminders before applications close",
      "Saved searches",
    ],
  },

  /**
   * Colours. `brand` is the main blue (buttons, hero), `accent` the darker
   * blue for links and hover states, `sky` the light end of the hero
   * gradient, `candy` the pink used for "closing soon", `highlight` the
   * yellow of the main call-to-action buttons, `ink` the text colour.
   */
  colors: {
    brand: "#1D5BFF",
    accent: "#0F44D6",
    sky: "#38C6FF",
    candy: "#E8227A",
    /** Sunshine yellow for the main "Get email alerts" buttons. */
    highlight: "#FFD23F",
    ink: "#0B1B3F",
  },

  /**
   * Legal line shown in the footer. Keep a non-affiliation notice:
   * the site lists vacancies from these organizations but is not run by them.
   */
  disclaimer:
    "Global Careers Hub is an independent job discovery site. It is not affiliated with, endorsed by or acting for the United Nations or any organization listed. Applications are made only on each employer's official website.",

  /** Optional social links shown in the footer. Leave empty to hide. */
  social: {
    linkedin: "",
    x: "",
  },
} as const;

export default siteConfig;
export type SiteConfig = typeof siteConfig;
