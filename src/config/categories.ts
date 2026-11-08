/**
 * Job categories. Each imported vacancy is placed in the first
 * category whose keywords appear in its TITLE (descriptions are not
 * used, because they mention many unrelated roles). If nothing
 * matches, the job goes to "Other". Admins can change a job's
 * category by hand in /admin/jobs.
 *
 * Order matters: more specific categories come first.
 */
export type Category = {
  slug: string;
  name: string;
  /** Short line used on category landing pages. */
  blurb: string;
  /** Lower-case words or phrases matched against the job title as whole words. End a word with * to match any ending ("statistic*" matches statistics, statistician). */
  keywords: string[];
};

export const CATEGORIES: Category[] = [
  {
    slug: "data-analytics",
    name: "Data & Analytics",
    blurb: "Data analysts, statisticians, information management and research data roles.",
    keywords: [
      "data", "analytics", "statistic*", "information management",
      "business intelligence", "bi analyst", "gis", "enumerator*", "enumerador*", "enquêteur*", "data scientist", "data science", "dashboard",
    ],
  },
  {
    slug: "it",
    name: "IT",
    blurb: "Software, infrastructure, cybersecurity and digital systems roles.",
    keywords: [
      "ict", "information technology", "software", "developer", "programmer", "devops", "cyber",
      "cybersecurity", "information security", "network", "systems administrator", "cloud",
      "it officer", "it specialist", "it assistant", "it support", "it manager", "erp", "web developer",
      "solution architect", "database administrator",
    ],
  },
  {
    slug: "monitoring-evaluation",
    name: "Monitoring & Evaluation",
    blurb: "M&E, evaluation, accountability and learning roles.",
    keywords: ["monitoring and evaluation", "monitoring & evaluation", "m&e", "meal", "evaluation", "evaluator"],
  },
  {
    slug: "human-resources",
    name: "Human Resources",
    blurb: "HR, recruitment, talent and staff development roles.",
    keywords: [
      "human resources", "human resource", "hr", "recruitment", "recruiter", "talent", "staffing",
      "people and culture", "learning and development", "payroll",
    ],
  },
  {
    slug: "finance",
    name: "Finance",
    blurb: "Finance, accounting, budget, treasury and audit roles.",
    keywords: [
      "finance", "financial", "accountant", "accounting", "budget", "treasury", "auditor", "audit",
      "controller", "grants management",
    ],
  },
  {
    slug: "procurement-logistics",
    name: "Procurement & Logistics",
    blurb: "Procurement, supply chain, logistics and fleet roles.",
    keywords: ["procurement", "supply chain", "supply", "logistics", "logistician", "warehouse", "fleet", "contracts", "cold chain", "compras", "abastecimiento", "adquisiciones", "achats", "approvisionnement"],
  },
  {
    slug: "legal-compliance",
    name: "Legal & Compliance",
    blurb: "Legal officers, counsel, compliance, ethics and investigation roles.",
    keywords: ["legal", "lawyer", "counsel", "compliance", "ethics", "investigator", "investigation", "integrity", "safeguarding", "enquêtes"],
  },
  {
    slug: "health",
    name: "Health",
    blurb: "Public health, medical, nutrition and epidemiology roles.",
    keywords: [
      "health", "medical", "nurse", "doctor", "physician", "epidemiolog*", "nutrition", "immunization",
      "pharmac*", "clinical", "hiv", "malaria",
    ],
  },
  {
    slug: "communications",
    name: "Communications",
    blurb: "Communications, media, advocacy, editorial and public information roles.",
    keywords: [
      "communication*", "media", "public information", "advocacy", "editor", "writer",
      "content", "social media", "press", "outreach", "translator*", "interpreter*",
    ],
  },
  {
    slug: "policy-research",
    name: "Policy & Research",
    blurb: "Policy analysts, economists and researchers.",
    keywords: ["policy", "economist", "economics", "research", "researcher"],
  },
  {
    slug: "programme-management",
    name: "Programme Management",
    blurb: "Programme and project officers, managers and coordinators.",
    keywords: [
      "programme", "program", "project", "coordinator", "coordination", "humanitarian affairs",
      "partnership", "portfolio", "country director", "head of office", "field officer",
    ],
  },
  {
    slug: "administration",
    name: "Administration",
    blurb: "Administrative, office management and operations support roles.",
    keywords: [
      "administrative", "administration", "admin", "office manager", "secretary", "receptionist",
      "operations assistant", "operations associate", "operations officer", "operations manager", "operations director", "head of operations", "facilities", "maintenance", "driver", "clerk",
    ],
  },
];

export const OTHER_CATEGORY: Category = {
  slug: "other",
  name: "Other",
  blurb: "Roles that don't fit the categories above.",
  keywords: [],
};

export const ALL_CATEGORIES: Category[] = [...CATEGORIES, OTHER_CATEGORY];

export function categoryBySlug(slug: string | null | undefined): Category | undefined {
  if (!slug) return undefined;
  return ALL_CATEGORIES.find((c) => c.slug === slug);
}
