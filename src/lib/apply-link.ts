/** Lower case, no accents, words separated by single spaces (kept here so this file stays free of imports). */
const normalizeForCompare = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Applicant-tracking and form services: the right place to apply, but not the organization's own website. */
export const APPLICATION_SERVICES = [
  "myworkdayjobs.com", "workday.com", "icims.com", "taleo.net", "successfactors.com", "successfactors.eu", "oraclecloud.com",
  "pageuppeople.com", "smartrecruiters.com", "greenhouse.io", "lever.co", "bamboohr.com", "teamtailor.com", "hr-manager.net",
  "recruitee.com", "breezy.hr", "workable.com", "personio.de", "personio.com", "jobvite.com", "ashbyhq.com", "zohorecruit.com",
  "applytojob.com", "jazzhr.com", "hirehive.com", "ultipro.com", "csod.com", "dayforcehcm.com", "paylocity.com", "adp.com",
  "forms.gle", "kobotoolbox.org", "typeform.com", "jotform.com", "surveymonkey.com", "office.com", "microsoft.com",
  "cognitoforms.com", "formstack.com", "tally.so", "wufoo.com", "humanitarianjobs.org",
];
const onHost = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** Link shorteners and file-sharing hosts: where they lead can't be told from the address. */
const OPAQUE_HOSTS = ["bit.ly", "t.ly", "tinyurl.com", "ow.ly", "rb.gy", "lnkd.in", "google.com", "sharepoint.com", "dropbox.com"];
const TITLE_STOP = new Set(["for", "and", "the", "with", "from", "des", "les", "pour", "para", "senior", "junior", "officer", "consultant", "national", "international"]);

/**
 * A page about working for the employer (its careers home, a list of job categories, "diversity
 * and inclusion") rather than one vacancy: the site's front page, or an address with no vacancy
 * number that shares no word with the job's title. Recruitment systems and forms always count as
 * the vacancy. Used to prefer the vacancy's own link, and to label the button honestly.
 */
export function isGeneralCareersPage(url: string, title?: string | null): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as written */ }
  path = path.replace(/\/+$/, "");
  if (!path && !u.search) return true;
  // A recruitment system's front page names no vacancy (Oracle's ".../CandidateExperience/en/sites/CX_1001").
  if (/\/CandidateExperience\/[a-z-]+\/sites\/CX_\d+$/i.test(path) && !u.search) return true;
  if (onHost(host, APPLICATION_SERVICES) || onHost(host, OPAQUE_HOSTS)) return false;
  const rest = path + u.search;
  if (/\d{3,}/.test(rest) || /[?&](?:id|jid|job|jobid|req|rid|vacancy|pos|ref)=/i.test(u.search)) return false;
  if (/apply|application|postul|candidat|form/i.test(path.split("/").pop() ?? "")) return false;
  const titleWords = new Set(normalizeForCompare(title ?? "").split(" ").filter((w) => w.length >= 4 && !TITLE_STOP.has(w)));
  if (!titleWords.size) return false; // nothing to compare with: don't guess
  const pathWords = normalizeForCompare(rest.replace(/[/\-_.+=&?%]/g, " ")).split(" ");
  return !pathWords.some((w) => titleWords.has(w));
}

/** What kind of page an application link opens, so the button can say so honestly. */
const FORM_HOSTS = [
  "forms.gle", "kobotoolbox.org", "typeform.com", "jotform.com", "surveymonkey.com", "forms.office.com", "cognitoforms.com",
  "formstack.com", "tally.so", "wufoo.com",
];

export type ApplyLinkKind = "posting" | "form" | "homepage";

export function applyLinkKind(url: string | null | undefined, title?: string | null): ApplyLinkKind {
  if (!url) return "posting";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (FORM_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return "form";
    if (host === "docs.google.com" && u.pathname.startsWith("/forms")) return "form";
    const path = u.pathname.replace(/\/+$/, "");
    if (!path && !u.search) return "homepage";
    if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?)?\/?(?:careers?|jobs|vacancies|work-with-us|join-us|opportunities)?$/i.test(path) && !u.search) return "homepage";
    return title && isGeneralCareersPage(url, title) ? "homepage" : "posting";
  } catch {
    return "posting";
  }
}

/** Where the Apply button leads, said under the button. */
export function applyDestination(kind: ApplyLinkKind): string {
  return kind === "form" ? "the employer's application form" : kind === "homepage" ? "the employer's careers page" : "the vacancy on the employer's website";
}
