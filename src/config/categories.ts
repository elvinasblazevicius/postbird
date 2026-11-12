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
    name: "Data and analytics",
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
      "it operations", "it project", "it service", "it services", "it security", "it digital", "it intern", "it analyst", "it consultant",
      "it coordinator", "it associate", "it technician", "it administrator", "it engineer", "it infrastructure", "it systems",
      "traineeship in it", "service desk", "help desk", "helpdesk",
      "solution architect", "database administrator", "digital transformation", "telecommunication*",
    ],
  },
  {
    slug: "monitoring-evaluation",
    name: "Monitoring and evaluation",
    blurb: "M&E, evaluation, accountability and learning roles.",
    keywords: ["monitoring and evaluation", "monitoring & evaluation", "m&e", "meal", "evaluation", "evaluator", "monitoring", "suivi et evaluation", "seguimiento y evaluacion"],
  },
  {
    slug: "human-resources",
    name: "Human resources",
    blurb: "HR, recruitment, talent and staff development roles.",
    keywords: [
      "human resources", "human resource", "hr", "recruitment", "recruiter", "talent", "staffing",
      "people and culture", "learning and development", "payroll", "ressources humaines", "recursos humanos",
    ],
  },
  {
    slug: "finance",
    name: "Finance",
    blurb: "Finance, accounting, budget, treasury and audit roles.",
    keywords: [
      "finance", "financial", "accountant", "accounting", "budget", "treasury", "auditor", "audit",
      "controller", "grants management", "grant*", "investment officer", "credit", "banking", "comptable", "contador*", "finanzas",
    ],
  },
  {
    slug: "procurement-logistics",
    name: "Procurement and logistics",
    blurb: "Procurement, supply chain, logistics and fleet roles.",
    keywords: ["procurement", "supply chain", "supply", "logistics", "logistician", "warehouse", "fleet", "contracts", "cold chain", "storekeeper", "transport", "compras", "abastecimiento", "adquisiciones", "achats", "approvisionnement", "logistique", "logistica"],
  },
  {
    slug: "legal-compliance",
    name: "Legal and compliance",
    blurb: "Legal officers, counsel, compliance, ethics and investigation roles.",
    keywords: ["legal", "lawyer", "counsel", "compliance", "ethics", "investigator", "investigation", "integrity", "safeguarding", "enquêtes", "juriste", "juridique", "jurídico", "abogado", "rule of law"],
  },
  {
    slug: "food-security-agriculture",
    name: "Food security and agriculture",
    blurb: "Food security, agriculture, livelihoods, livestock and fisheries roles.",
    keywords: [
      "food security", "food systems", "food assistance", "agricultur*", "agronom*", "agri*", "livestock", "veterinar*", "fisheries", "aquaculture",
      "farming", "farmer*", "crop*", "irrigation", "school feeding", "livelihood*", "rural development", "value chain*", "seguridad alimentaria", "securite alimentaire", "agricola",
      // Genebanks (CGIAR and others). Not "gene*", which would also match "general" and "Geneva".
      "gene", "genes", "genebank*", "gene bank*", "genetic resource*", "germplasm",
    ],
  },
  {
    slug: "health",
    name: "Health",
    blurb: "Public health, medical, nutrition and epidemiology roles.",
    keywords: [
      "health", "medical", "nurse", "nursing", "doctor", "physician", "epidemiolog*", "nutrition*", "immunization", "vaccin*",
      "pharmac*", "clinical", "hiv", "malaria", "tuberculosis", "midwi*", "surgeon", "laboratory", "mental health", "psychosocial", "mhpss",
      "salud", "sante", "medecin", "medico", "infirmier*", "enfermer*",
    ],
  },
  {
    slug: "wash",
    name: "Water, sanitation and hygiene",
    blurb: "WASH engineers, officers and specialists in water supply, sanitation and hygiene.",
    keywords: ["wash", "water", "sanitation", "hygiene", "watsan", "eau", "assainissement", "agua", "saneamiento"],
  },
  {
    slug: "education",
    name: "Education",
    blurb: "Education specialists, teachers, early childhood and education-in-emergencies roles.",
    keywords: ["education", "educational", "teacher*", "teaching", "school*", "literacy", "early childhood", "curriculum", "tvet", "educacion", "enseignant*", "docente*"],
  },
  {
    slug: "security",
    name: "Security",
    blurb: "Security officers, advisers, analysts and safety and security roles.",
    keywords: [
      "security officer", "security assistant", "security associate", "security advisor", "security adviser", "security analyst",
      "security manager", "security coordinator", "security specialist", "security focal point", "field security", "safety and security",
      "security and safety", "close protection", "guard", "guards", "seguridad", "securite",
    ],
  },
  {
    slug: "protection-humanitarian-affairs",
    name: "Protection and humanitarian affairs",
    blurb: "Protection, child protection, gender-based violence, refugee and humanitarian affairs roles.",
    keywords: [
      "protection", "child protection", "gbv", "gender based violence", "psea", "humanitarian", "refugee*", "resettlement", "asylum",
      "durable solutions", "camp management", "cccm", "shelter", "civil military", "human rights", "displacement",
      "proteccion", "proteccion de la infancia", "humanitaire", "humanitaria*", "emergency",
    ],
  },
  {
    slug: "gender",
    name: "Gender",
    blurb: "Gender equality and women's empowerment roles.",
    keywords: ["gender", "women", "womens", "gender equality", "genero", "gbv", "sgbv", "vbg", "gender-based violence", "violence basee sur le genre", "violences basees sur le genre"],
  },
  {
    slug: "environment-climate-energy",
    name: "Environment, climate and energy",
    blurb: "Environment, climate change, energy, biodiversity and disaster risk reduction roles.",
    keywords: [
      "environment*", "climate", "energy", "renewable*", "biodiversity", "conservation", "forest*", "carbon", "emission*",
      "sustainability", "sustainable", "natural resource*", "marine", "ocean*", "chemical*", "pollution", "solar", "electricity",
      "disaster risk", "drr", "resilience", "ecosystem*", "wildlife", "flood*", "medio ambiente", "environnement", "climat", "clima",
    ],
  },
  {
    slug: "engineering-infrastructure",
    name: "Engineering and infrastructure",
    blurb: "Engineers, infrastructure, construction and architecture roles.",
    keywords: [
      "engineer*", "engineering", "infrastructure", "construction", "civil works", "architect", "architecture", "quantity surveyor", "surveyor",
      "electrical", "mechanical", "urban", "roads", "ingeniero*", "ingenieur*", "infraestructura",
    ],
  },
  {
    slug: "communications",
    name: "Communications",
    blurb: "Communications, media, advocacy, editorial and public information roles.",
    keywords: [
      "communication*", "media", "public information", "advocacy", "editor", "writer",
      "content", "social media", "press", "outreach", "translator*", "interpreter*", "translation", "reporting officer",
      "external relations", "fundraising", "resource mobilization", "donor relations", "comunicacion",
    ],
  },
  {
    slug: "policy-research",
    name: "Policy and research",
    blurb: "Policy analysts, economists and researchers.",
    keywords: ["policy", "economist", "economics", "research", "researcher", "governance", "political affairs", "political", "peacebuilding"],
  },
  {
    slug: "programme-management",
    name: "Programme management",
    blurb: "Programme and project officers, managers and coordinators.",
    keywords: [
      "programme", "program", "project", "projects", "coordinator", "coordination", "partnership*", "portfolio",
      "country director", "director", "head of entity", "head of office", "field office", "field officer", "chief of party", "team leader",
      "head of mission", "head of programme", "area manager", "base manager", "representative", "programa", "proyecto", "projet",
    ],
  },
  {
    slug: "administration",
    name: "Administration",
    blurb: "Administrative, office management and operations support roles.",
    keywords: [
      "administrative", "administration", "admin", "office manager", "secretary", "receptionist",
      "operations assistant", "operations associate", "operations officer", "operations manager", "operations director", "head of operations", "facilities", "maintenance", "driver", "clerk",
      "operations", "assistant", "office", "administrativo", "administratif", "asistente", "chauffeur", "conductor", "cleaner", "cook",
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
