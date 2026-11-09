/**
 * What the Apply button opens, said in plain words under it: "Opens IOM's recruitment system
 * (Oracle)", "Opens UNICEF's careers site" (with its address), "Opens an application form
 * (Google Forms)". The raw address is shown only when it is the organization's own website, never
 * for a recruitment service's long technical hostname (fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com).
 */
import { KNOWN_ORGS, type KnownOrg } from "@/config/organizations";
import { domainMatchesOrg, endsWithHost, siteDomain } from "@/lib/feeds/employer-link";
import { orgInText } from "@/lib/org-names";
import { normalizeForCompare } from "@/lib/text";

type System = { label: string; hosts: string[]; kind: "system" | "form" };

/**
 * Recruitment systems (applicant-tracking software) and form services, by hostname. A hostname
 * matches its own entry and every subdomain of it. The UN's own systems come first: they are
 * named by their own names, Inspira and UN Careers.
 */
const SYSTEMS: System[] = [
  { label: "Inspira", hosts: ["inspira.un.org"], kind: "system" },
  { label: "UN Careers", hosts: ["careers.un.org"], kind: "system" },
  { label: "Oracle", hosts: ["oraclecloud.com"], kind: "system" },
  { label: "Taleo", hosts: ["taleo.net"], kind: "system" },
  { label: "SuccessFactors", hosts: ["successfactors.com", "successfactors.eu", "sapsf.com", "sapsf.eu"], kind: "system" },
  { label: "Workday", hosts: ["myworkdayjobs.com", "myworkdaysite.com", "workday.com"], kind: "system" },
  { label: "SmartRecruiters", hosts: ["smartrecruiters.com"], kind: "system" },
  { label: "Greenhouse", hosts: ["greenhouse.io"], kind: "system" },
  { label: "Lever", hosts: ["lever.co"], kind: "system" },
  { label: "iCIMS", hosts: ["icims.com"], kind: "system" },
  { label: "Cornerstone", hosts: ["csod.com"], kind: "system" },
  { label: "PageUp", hosts: ["pageuppeople.com"], kind: "system" },
  { label: "BambooHR", hosts: ["bamboohr.com"], kind: "system" },
  { label: "Teamtailor", hosts: ["teamtailor.com"], kind: "system" },
  { label: "Workable", hosts: ["workable.com"], kind: "system" },
  { label: "Recruitee", hosts: ["recruitee.com"], kind: "system" },
  { label: "Jobvite", hosts: ["jobvite.com"], kind: "system" },
  { label: "Ashby", hosts: ["ashbyhq.com"], kind: "system" },
  { label: "Personio", hosts: ["personio.de", "personio.com"], kind: "system" },
  { label: "Zoho Recruit", hosts: ["zohorecruit.com"], kind: "system" },
  { label: "Breezy HR", hosts: ["breezy.hr"], kind: "system" },
  { label: "JazzHR", hosts: ["applytojob.com", "jazzhr.com"], kind: "system" },
  { label: "HR Manager", hosts: ["hr-manager.net"], kind: "system" },
  { label: "Easycruit", hosts: ["easycruit.com"], kind: "system" },
  { label: "UKG", hosts: ["ultipro.com"], kind: "system" },
  { label: "Dayforce", hosts: ["dayforcehcm.com"], kind: "system" },
  { label: "Google Forms", hosts: ["forms.gle"], kind: "form" },
  { label: "Microsoft Forms", hosts: ["forms.office.com"], kind: "form" },
  { label: "KoboToolbox", hosts: ["kobotoolbox.org"], kind: "form" },
  { label: "Typeform", hosts: ["typeform.com"], kind: "form" },
  { label: "Jotform", hosts: ["jotform.com"], kind: "form" },
  { label: "SurveyMonkey", hosts: ["surveymonkey.com"], kind: "form" },
];

const cleanHost = (host: string) => host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

/** The recruitment system or form service behind an application link's hostname (and path, for Google Forms), or null. */
export function recruitmentSystem(host: string, path = ""): { label: string; kind: "system" | "form" } | null {
  const h = cleanHost(host);
  if (!h) return null;
  if (h === "docs.google.com" && path.startsWith("/forms")) return { label: "Google Forms", kind: "form" };
  const s = SYSTEMS.find((x) => endsWithHost(h, x.hosts));
  return s ? { label: s.label, kind: s.kind } : null;
}

const KNOWN_BY_NAME = new Map<string, KnownOrg>();
for (const o of KNOWN_ORGS) for (const n of [o.name, o.short, ...(o.aliases ?? [])]) if (n && !KNOWN_BY_NAME.has(normalizeForCompare(n))) KNOWN_BY_NAME.set(normalizeForCompare(n), o);

/**
 * Is this hostname the organization's own website? Its listed career domains (src/config/organizations.ts)
 * when it is a known organization, or a domain whose name clearly matches the organization's
 * ("acted.org" for ACTED, "nrc.no" for the Norwegian Refugee Council). Never a recruitment service.
 */
export function isOrgOwnHost(host: string, orgName: string | null | undefined, orgShort: string | null | undefined): boolean {
  const h = cleanHost(host);
  if (!h || !orgName || recruitmentSystem(h)) return false;
  const known = KNOWN_BY_NAME.get(normalizeForCompare(orgName)) ?? (orgShort ? KNOWN_BY_NAME.get(normalizeForCompare(orgShort)) : undefined);
  if (known?.domains?.length && endsWithHost(h, known.domains)) return true;
  return domainMatchesOrg(siteDomain(h), orgName, orgShort);
}

/** "IOM's", "the World Bank's", "the UN's"; "the employer's" when the organization isn't known. */
function possessive(orgName: string | null | undefined, orgShort: string | null | undefined): string {
  const ref = orgInText(orgName, orgShort);
  if (!ref) return "the employer’s";
  return `${ref === "UN" ? "the UN" : ref}’s`;
}

export type ApplyTarget = { text: string; host: string | null };

/**
 * The line under the Apply button. `host` is the address to show under it (the organization's own
 * site only), or null. `homepage`: the link opens a careers home page rather than the vacancy.
 */
export function applyTarget(opts: { url: string; host: string; orgName: string | null; orgShort: string | null; homepage?: boolean }): ApplyTarget {
  let path = "";
  try {
    path = new URL(opts.url).pathname;
  } catch {
    // keep the empty path
  }
  const whose = possessive(opts.orgName, opts.orgShort);
  const system = recruitmentSystem(opts.host, path);
  if (system?.kind === "form") return { text: `Opens an application form (${system.label})`, host: null };
  if (system) return { text: `Opens ${whose} recruitment system (${system.label})`, host: null };
  if (isOrgOwnHost(opts.host, opts.orgName, opts.orgShort)) {
    return { text: `Opens ${whose} ${opts.homepage ? "careers page" : "careers site"}`, host: cleanHost(opts.host) };
  }
  return { text: `Opens ${opts.homepage ? "the employer’s careers page" : "the vacancy on the employer’s website"}`, host: null };
}
