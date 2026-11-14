/**
 * Finding the employer's own links inside a vacancy text.
 *
 * Job boards re-post vacancies with a "How to apply" section that links to
 * the employer's application page. The site only ever links to the employer,
 * so for job-board items we read that link here, and we also work out the
 * organization's own website (used for its logo).
 */
import { normalizeForCompare } from "@/lib/text";
import { hostOf, isAggregatorUrl, isListingSite } from "./url";
import { APPLICATION_SERVICES, isGeneralCareersPage } from "@/lib/apply-link";

export { isGeneralCareersPage };

/** Hosts that never count as an organization's own website. */
const NOT_ORG_SITES = ["google.com", "googleusercontent.com", "dropbox.com", "onedrive.live.com", "sharepoint.com", "wetransfer.com", "bit.ly", "t.ly", "tinyurl.com"];
/** UN procurement portal: a link there means a tender, not a job. */
export const PROCUREMENT_HOSTS = ["ungm.org"];
/** Programme pages of funders that postings mention (a JICA-funded UN Volunteer post links to JICA's page about the scheme): never the application. */
const FUNDER_PAGES = ["jica.go.jp"];
const SOCIAL = ["facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "youtu.be", "tiktok.com", "whatsapp.com", "t.me", "wa.me"];

const JOBISH = /(job|career|vacanc|recruit|apply|application|position|opportunit|requisition|talent|hiring|work(?:ing)?-(?:with|for|at|internationally)|join-?us|emploi|empleo|candidat|postul|\bforms?\b|viewform)/i;
const FILE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar)(?:$|[?#])/i;

export function endsWithHost(host: string, list: string[]) {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Turn wrapped or messy hrefs into the real address (Outlook Safe Links, Google redirects, markdown leftovers). */
export function cleanLink(raw: string): string | null {
  let u = raw.trim().replace(/&amp;/g, "&");
  u = u.split(/\*\*|\]\(|\s/)[0].replace(/[).,;:'"\]]+$/, "");
  if (!/^https?:\/\//i.test(u)) return null;
  for (let i = 0; i < 2; i++) {
    try {
      const parsed = new URL(u);
      const h = parsed.hostname.toLowerCase();
      const inner =
        h.endsWith("safelinks.protection.outlook.com") ? parsed.searchParams.get("url") :
        (h === "www.google.com" || h === "google.com") && parsed.pathname === "/url" ? parsed.searchParams.get("q") ?? parsed.searchParams.get("url") :
        null;
      if (inner && /^https?:\/\//i.test(inner)) { u = inner; continue; }
      return parsed.toString();
    } catch {
      return null;
    }
  }
  return u;
}

const BOARD_NAMES = /reliefweb|unjobs|impactpool|devex|unjobnet|idealist|unvacancies|untalent|eurobrussels|inoreader/i;

/** Remove tracking parameters that name the job board ("?promotion=…-reliefweb", "utm_source=reliefweb"). */
export function stripBoardTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const [k, v] of [...u.searchParams.entries()]) {
      if (BOARD_NAMES.test(v) || BOARD_NAMES.test(k) || /^utm_/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

type Found = { url: string; index: number };

/** Links in an HTML or plain-text body, in order of appearance. */
function linksIn(body: string): Found[] {
  const out: Found[] = [];
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi)) {
    const url = cleanLink(m[1]);
    if (url) out.push({ url, index: m.index ?? 0 });
  }
  const text = body.replace(/<a\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = cleanLink(m[0]);
    if (url && !out.some((f) => f.url === url)) out.push({ url, index: body.indexOf(m[0]) >= 0 ? body.indexOf(m[0]) : Number.MAX_SAFE_INTEGER });
  }
  return out.sort((a, b) => a.index - b.index);
}

function usable(url: string): boolean {
  const host = hostOf(url);
  if (!host || isAggregatorUrl(url) || isListingSite(host) || endsWithHost(host, SOCIAL) || endsWithHost(host, FUNDER_PAGES)) return false;
  if (FILE.test(url) || /[?&](action|module)=download|\/download\b/i.test(url)) return false;
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return /\/jobs\/view\//.test(url);
  return true;
}

/**
 * A link to an article rather than a vacancy: its last path part is a phrase of five words or more
 * and no word of the title is in the address ("/careers/using-ai-responsibly-undp-recruitment-and-selection").
 */
/**
 * A page of guidance, not a vacancy: a user guide or manual, an FAQ, a publication or "how to apply"
 * ("who.int/publications/m/item/stellis-user-guide-how-to-apply-to-who-job-opportunities").
 */
export function isGuideLink(url: string): boolean {
  let path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch { return false; }
  if (/(?:^|[/_-])(?:user[-_]guides?|user[-_]manuals?|faqs?|publications?|how[-_]to[-_]apply)(?=[/_.-]|$)/.test(path)) return true;
  // Pages about the employer's recruitment rather than a vacancy: "diversity, equity and inclusion",
  // competency frameworks, the recruitment process, "resources" (IOM's candidate tier systems).
  if (/(?:^|\/)(?:resources)\//.test(path)) return true;
  return /(?:diversity[-_]equity|equity[-_]and[-_]inclusion|competencies|recruitment[-_]process|our[-_]values)(?=[/_.-]|$)/.test(path);
}

export function isArticleLink(url: string, title: string): boolean {
  let last = "";
  try { last = new URL(url).pathname.replace(/\/+$/, "").split("/").pop() ?? ""; } catch { return false; }
  if (/\d/.test(last) || last.split(/[-_]+/).filter((w) => /^[a-z]+$/i.test(w)).length < 5) return false;
  return isGeneralCareersPage(url, title);
}

/**
 * The employer's application link from a job-board posting: the first job-like
 * link after "How to apply" (or anywhere, if the section has none), preferring the
 * vacancy's own page over a general careers page when the posting has both. Returns
 * null when the posting only gives an email address or no usable link.
 */
export function findEmployerLink(body: string, title?: string | null): string | null {
  if (!body) return null;
  const links = linksIn(body).filter((l) => usable(l.url) && !isGuideLink(l.url));
  if (!links.length) return null;
  const how = body.search(/how to apply|application (?:process|procedure|instructions)|to apply\b|comment postuler|modalit[ée]s de candidature|c[óo]mo (?:postular|aplicar)|para postular/i);
  const jobish = (l: Found) => JOBISH.test(l.url) || endsWithHost(hostOf(l.url), APPLICATION_SERVICES);
  const own = (l: Found) => jobish(l) && !isGeneralCareersPage(l.url, title);
  // A page named by a sentence that isn't this vacancy ("/careers/using-ai-responsibly-undp-recruitment-and-selection"):
  // an article, never the place to apply, even as a fallback.
  const article = (l: Found) => {
    const last = (() => { try { return new URL(l.url).pathname.replace(/\/+$/, "").split("/").pop() ?? ""; } catch { return ""; } })();
    return last.split(/[-_]+/).filter((w) => /^[a-z]+$/i.test(w)).length >= 5;
  };
  const fallback = (l: Found) => jobish(l) && !article(l);
  const after = how >= 0 ? links.filter((l) => l.index > how) : [];
  const found = (after.find(own) ?? links.find(own) ?? after.find(fallback) ?? links.find(fallback))?.url;
  return found ? stripBoardTracking(found) : null;
}

const STOP = new Set(["for", "and", "of", "the", "de", "du", "des", "la", "le", "les", "et", "y", "en", "in", "on", "to", "a", "an", "pour", "por", "para", "del", "di"]);

/** Registrable domain, roughly: "careers.example.org" → "example.org", "x.org.uk" → "x.org.uk". */
export function siteDomain(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2];
  const take = parts[parts.length - 1].length === 2 && ["co", "org", "or", "ac", "gov", "com", "net", "ne", "go"].includes(sld) ? 3 : 2;
  return parts.slice(-take).join(".");
}

/** Does this domain plausibly belong to the named organization? ("concern.net" ↔ "Concern Worldwide", "drc.ngo" ↔ "Danish Refugee Council") */
export function domainMatchesOrg(domain: string, orgName: string, short?: string | null): boolean {
  const words = normalizeForCompare(orgName).split(" ").filter(Boolean);
  const significant = words.filter((w) => !STOP.has(w));
  const joined = significant.join("");
  const acronyms = new Set([significant.map((w) => w[0]).join(""), words.map((w) => w[0]).join("")]);
  if (short) acronyms.add(normalizeForCompare(short).replace(/[^a-z0-9]/g, ""));
  const labels = domain.split(".").slice(0, -1).flatMap((l) => [l, ...l.split("-")]).map((l) => normalizeForCompare(l).replace(/\s/g, ""));
  return labels.some((l) =>
    l.length >= 3 && (
      acronyms.has(l) ||
      (joined.length >= 5 && (l === joined || joined.startsWith(l) && l.length >= 6)) ||
      significant.some((w) => w.length >= 5 && l.includes(w))
    ));
}

/**
 * The organization's own website from links we have (the application link,
 * then links in the text), only when the domain clearly matches its name.
 */
export function findOrgWebsite(orgName: string, short: string | null, urls: string[]): string | null {
  for (const url of urls) {
    const host = hostOf(url);
    if (!host || !usable(url) || endsWithHost(host, APPLICATION_SERVICES) || endsWithHost(host, NOT_ORG_SITES)) continue;
    const domain = siteDomain(host);
    if (domainMatchesOrg(domain, orgName, short)) return domain;
  }
  return null;
}

/** All usable links in a body (for website detection). */
export function allLinks(body: string): string[] {
  return linksIn(body).map((l) => l.url);
}
