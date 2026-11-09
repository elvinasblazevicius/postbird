/**
 * Landing pages by type of employer (/un-jobs, /eu-jobs, /development-bank-jobs, /ngo-jobs),
 * built on the organization-type filter (ORG_TYPES in src/config/regions.ts).
 */
export type EmployerTypePage = {
  /** The ORG_TYPES value the page is fixed to. */
  orgtype: "un" | "eu" | "ifi" | "ngo";
  path: string;
  /** Page heading and breadcrumb. */
  title: string;
  /** Short name for the homepage links. */
  label: string;
  metaTitle: string;
  intro: string;
  /** For "Get an email when new … vacancies are posted". */
  alertNoun: string;
};

export const EMPLOYER_TYPE_PAGES: EmployerTypePage[] = [
  {
    orgtype: "un",
    path: "/un-jobs",
    title: "UN jobs",
    label: "UN system",
    metaTitle: "UN jobs: vacancies at UN agencies, funds and programmes",
    intro: "Vacancies at UN agencies, funds and programmes. Each one links to the agency's own careers site, where you apply.",
    alertNoun: "UN",
  },
  {
    orgtype: "eu",
    path: "/eu-jobs",
    title: "EU jobs",
    label: "EU institutions",
    metaTitle: "EU jobs: vacancies at EU institutions and agencies",
    intro: "Vacancies at EU institutions and agencies. Each one links to the institution's own careers page, where you apply.",
    alertNoun: "EU",
  },
  {
    orgtype: "ifi",
    path: "/development-bank-jobs",
    title: "Development bank jobs",
    label: "Development banks",
    metaTitle: "Development bank jobs: vacancies at development banks and IFIs",
    intro: "Vacancies at development banks and other international financial institutions. Each one links to the employer's own careers site, where you apply.",
    alertNoun: "development bank",
  },
  {
    orgtype: "ngo",
    path: "/ngo-jobs",
    title: "NGO jobs",
    label: "NGOs",
    metaTitle: "NGO jobs: vacancies at international NGOs",
    intro: "Vacancies at international non-governmental organizations. Each one links to the NGO's own careers site, where you apply.",
    alertNoun: "NGO",
  },
];

export function employerTypePage(orgtype: EmployerTypePage["orgtype"]): EmployerTypePage {
  return EMPLOYER_TYPE_PAGES.find((p) => p.orgtype === orgtype)!;
}
