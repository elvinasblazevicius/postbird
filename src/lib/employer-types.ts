/**
 * Landing pages by type of employer (/un-jobs, /eu-jobs, /development-bank-jobs, /ngo-jobs,
 * /international-organization-jobs),
 * built on the organization-type filter (ORG_TYPES in src/config/regions.ts).
 */
export type EmployerTypePage = {
  /** The ORG_TYPES value the page is fixed to. */
  orgtype: "un" | "eu" | "ifi" | "ngo" | "io";
  path: string;
  /** Page heading and breadcrumb. */
  title: string;
  /** Short name for the homepage links and other navigation (plural: "NGOs"). */
  label: string;
  /** One employer of this type, on job and organization pages ("NGO", "Development bank"). */
  singular: string;
  metaTitle: string;
  intro: string;
  /** For "Get an email when new … vacancies are posted". */
  alertNoun: string;
  /** While the page has no listings: "We don't list any vacancies from {emptyName} right now." */
  emptyName: string;
};

export const EMPLOYER_TYPE_PAGES: EmployerTypePage[] = [
  {
    orgtype: "un",
    path: "/un-jobs",
    title: "UN jobs",
    label: "UN system",
    singular: "UN system organization",
    metaTitle: "UN jobs: vacancies at UN agencies, funds and programmes",
    intro: "Vacancies at UN agencies, funds and programmes.",
    alertNoun: "UN",
    emptyName: "UN system organizations",
  },
  {
    orgtype: "eu",
    path: "/eu-jobs",
    title: "EU jobs",
    label: "EU institutions",
    singular: "EU institution",
    metaTitle: "EU jobs: vacancies at EU institutions and agencies",
    intro: "Vacancies at EU institutions and agencies.",
    alertNoun: "EU",
    emptyName: "EU institutions",
  },
  {
    orgtype: "ifi",
    path: "/development-bank-jobs",
    title: "Development bank jobs",
    label: "Development banks",
    singular: "Development bank",
    metaTitle: "Development bank jobs: vacancies at development banks and IFIs",
    intro: "Vacancies at development banks and other international financial institutions.",
    alertNoun: "development bank",
    emptyName: "development banks",
  },
  {
    orgtype: "ngo",
    path: "/ngo-jobs",
    title: "NGO jobs",
    label: "NGOs",
    singular: "NGO",
    metaTitle: "NGO jobs: vacancies at international NGOs",
    intro: "Vacancies at international non-governmental organizations.",
    alertNoun: "NGO",
    emptyName: "international NGOs",
  },
  {
    orgtype: "io",
    path: "/international-organization-jobs",
    title: "Jobs at other international organizations",
    label: "Other international organizations",
    singular: "International organization",
    metaTitle: "Jobs at other international organizations, outside the UN and EU",
    intro: "Vacancies at international and intergovernmental organizations outside the UN system and the EU.",
    alertNoun: "international organization",
    emptyName: "other international organizations",
  },
];

export function employerTypePage(orgtype: EmployerTypePage["orgtype"]): EmployerTypePage {
  return EMPLOYER_TYPE_PAGES.find((p) => p.orgtype === orgtype)!;
}
