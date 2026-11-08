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
  /** One line describing the site (meta description default). */
  description:
    "Vacancies from UN agencies, international organizations and NGOs, gathered in one place and linked straight to the official application pages.",

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
      "Open positions at United Nations agencies, international organizations, humanitarian groups and NGOs — searchable in one place, with every listing linked to the employer's official vacancy page.",
  },

  /**
   * Premium plan shown on /pricing. Billing is NOT switched on yet: the
   * "Start free trial" button records interest (a "fake door" test) and
   * tells visitors honestly that Premium opens soon. Change the price
   * here to test different price points.
   */
  premium: {
    name: "Premium alerts",
    price: "$4",
    period: "month",
    trialDays: 14,
    features: [
      "Daily alerts filtered by keyword, organization and location",
      "Deadline reminders before applications close",
      "Saved searches",
    ],
  },

  /** Colours. `brand` is the main navy; `accent` is used for links and buttons. */
  colors: {
    brand: "#16325C",
    accent: "#1F4E8C",
    ink: "#0E1B2C",
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
