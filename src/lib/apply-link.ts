/** What kind of page an application link opens, so the button can say so honestly. */
const FORM_HOSTS = [
  "forms.gle", "kobotoolbox.org", "typeform.com", "jotform.com", "surveymonkey.com", "forms.office.com", "cognitoforms.com",
  "formstack.com", "tally.so", "wufoo.com",
];

export type ApplyLinkKind = "posting" | "form" | "homepage";

export function applyLinkKind(url: string | null | undefined): ApplyLinkKind {
  if (!url) return "posting";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (FORM_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return "form";
    if (host === "docs.google.com" && u.pathname.startsWith("/forms")) return "form";
    const path = u.pathname.replace(/\/+$/, "");
    if (!path && !u.search) return "homepage";
    if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?)?\/?(?:careers?|jobs|vacancies|work-with-us|join-us|opportunities)?$/i.test(path) && !u.search) return "homepage";
    return "posting";
  } catch {
    return "posting";
  }
}

/** Where the Apply button leads, said under the button. */
export function applyDestination(kind: ApplyLinkKind): string {
  return kind === "form" ? "the employer's application form" : kind === "homepage" ? "the employer's careers page" : "the vacancy on the employer's website";
}
