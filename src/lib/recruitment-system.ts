/**
 * What the Apply button opens, said in plain words under it: "Opens IOM's recruitment system
 * (Oracle)", "Opens UNICEF's careers site" (with its address), "Opens the careers site of Blue
 * Ventures", "Opens an application form
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

/** The known organization (src/config/organizations.ts) with this name or short name, if any. */
export function knownOrg(orgName: string | null | undefined, orgShort: string | null | undefined): KnownOrg | undefined {
  return (orgName ? KNOWN_BY_NAME.get(normalizeForCompare(orgName)) : undefined) ?? (orgShort ? KNOWN_BY_NAME.get(normalizeForCompare(orgShort)) : undefined);
}

/**
 * The organization's own site for its page, from its known domains: a careers host
 * ("careers.un.org", "eu-careers.europa.eu") when one is listed, otherwise its main domain. `careers`
 * says which, so the link is named for what it is. Null when the organization has no known domain.
 */
export function officialSite(orgName: string | null | undefined, orgShort: string | null | undefined): { href: string; host: string; careers: boolean } | null {
  const domains = knownOrg(orgName, orgShort)?.domains ?? [];
  const careersHost = domains.find((d) => /(^|[.-])(careers?|jobs)([.-]|$)/.test(d));
  const host = careersHost ?? domains[0];
  return host ? { href: `https://${host}`, host, careers: Boolean(careersHost) } : null;
}

/**
 * Is this hostname the organization's own website? Its listed career domains (src/config/organizations.ts)
 * when it is a known organization, or a domain whose name clearly matches the organization's
 * ("acted.org" for ACTED, "nrc.no" for the Norwegian Refugee Council). Never a recruitment service.
 */
export function isOrgOwnHost(host: string, orgName: string | null | undefined, orgShort: string | null | undefined): boolean {
  const h = cleanHost(host);
  if (!h || !orgName || recruitmentSystem(h)) return false;
  const known = knownOrg(orgName, orgShort);
  if (known?.domains?.length && endsWithHost(h, known.domains)) return true;
  return domainMatchesOrg(siteDomain(h), orgName, orgShort);
}

/**
 * How the organization is named as an owner: "IOM’s", "the World Bank’s", "the UN’s"; "the
 * employer’s" when the organization isn't known. A name ending in "s" (Blue Ventures, Médecins
 * Sans Frontières) or longer than three words (not counting "the") reads badly with "’s", so it
 * takes "of" instead: `of` is then set and `pre` is null ("the careers site of Blue Ventures").
 */
export function possessive(orgName: string | null | undefined, orgShort: string | null | undefined): { pre: string; of: null } | { pre: null; of: string } {
  const ref = orgInText(orgName, orgShort);
  if (!ref) return { pre: "the employer’s", of: null };
  const name = ref === "UN" ? "the UN" : ref;
  const words = name.replace(/^the\s+/i, "").split(/\s+/).filter(Boolean);
  if (/s$/i.test(name) || words.length > 3) return { pre: null, of: name };
  return { pre: `${name}’s`, of: null };
}

/** "IOM’s careers site", "the careers site of Blue Ventures". */
function owned(thing: string, owner: ReturnType<typeof possessive>): string {
  return owner.of ? `the ${thing} of ${owner.of}` : `${owner.pre} ${thing}`;
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
  if (system) return { text: `Opens ${owned("recruitment system", whose)} (${system.label})`, host: null };
  if (isOrgOwnHost(opts.host, opts.orgName, opts.orgShort)) {
    return { text: `Opens ${owned(opts.homepage ? "careers page" : "careers site", whose)}`, host: cleanHost(opts.host) };
  }
  return { text: `Opens ${opts.homepage ? "the employer’s careers page" : "the vacancy on the employer’s website"}`, host: null };
}
