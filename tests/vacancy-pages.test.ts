import { describe, expect, it } from "vitest";
import { parseRobots, robotsAllows } from "@/lib/feeds/robots";
import { factsFromJobPosting, factsFromSystem, factsFromText, oracleApiUrl, plausibleDeadline, smartRecruitersApiUrl, workdayApiUrl, factsFromPage } from "@/lib/feeds/vacancy-page";
import { boardListingOf } from "@/lib/feeds/board-links";
import { withPageFacts } from "@/lib/feeds/sync";
import type { RawItem } from "@/lib/feeds/parse";

const item = (links: string[]): RawItem => ({ guid: null, title: "IRC PIR Caseworker", links, summaryHtml: null, contentHtml: null, published: null, updated: null, author: null, categories: [], sourceTitle: null, sourceUrl: null });

import { findEmployerLink, isGeneralCareersPage } from "@/lib/feeds/employer-link";
import { applyLinkKind } from "@/lib/apply-link";
describe("robots.txt", () => {
  const unjobnet = "User-agent: *\nDisallow: /jd/\nDisallow: /go/\n\nUser-agent: Diffbot\nUser-agent: Omgili\nDisallow: /\n";
  it("follows the * group unless our name has its own", () => {
    const r = parseRobots(unjobnet, "PostbirdBot");
    expect(robotsAllows(r, "/apply/90553662")).toBe(true);
    expect(robotsAllows(r, "/go/123")).toBe(false);
    expect(robotsAllows(parseRobots(unjobnet, "Diffbot"), "/apply/1")).toBe(false);
  });
  it("closes everything for User-agent: * / Disallow: / (UNjobs)", () => {
    const r = parseRobots("User-agent: Googlebot\nDisallow:\nUser-agent: *\nDisallow: /\n", "PostbirdBot");
    expect(robotsAllows(r, "/vacancies/1")).toBe(false);
  });
  it("lets the longest rule win, Allow on a tie, with * and $", () => {
    const r = parseRobots("User-agent: *\nDisallow: /jobs\nAllow: /jobs/detail\nDisallow: /*.pdf$\n", "PostbirdBot");
    expect(robotsAllows(r, "/jobs/detail/x")).toBe(true);
    expect(robotsAllows(r, "/jobs/list")).toBe(false);
    expect(robotsAllows(r, "/files/a.pdf")).toBe(false);
  });
});

describe("recruitment systems", () => {
  it("builds the public job-data addresses", () => {
    expect(oracleApiUrl("https://fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/24002/?keyword=data")).toContain("finder=ById;Id=%2224002%22,siteNumber=CX_1001");
    expect(smartRecruitersApiUrl("https://jobs.smartrecruiters.com/OECD/744000159633919-auditeur-interne")).toBe("https://api.smartrecruiters.com/v1/companies/OECD/postings/744000159633919");
    expect(workdayApiUrl("https://theirc.wd1.myworkdayjobs.com/External_Careers/job/Louisville-KY-USA/PIR-Caseworker_JR00005970")).toBe("https://theirc.wd1.myworkdayjobs.com/wday/cxs/theirc/External_Careers/job/Louisville-KY-USA/PIR-Caseworker_JR00005970");
    expect(workdayApiUrl("https://theirc.wd1.myworkdayjobs.com/en-US/External_Careers/job/A/B_1")).toBe("https://theirc.wd1.myworkdayjobs.com/wday/cxs/theirc/External_Careers/job/A/B_1");
  });
  it("reads Oracle's closing date and place (IOM)", () => {
    const f = factsFromSystem("oracle", { items: [{ PrimaryLocation: "Bunia, Democratic Republic of the Congo", PrimaryLocationCountry: "CD", ExternalPostedEndDate: "2026-11-16T23:00:00+00:00" }] });
    expect(f).toMatchObject({ deadline: "2026-11-16", countryCode: "CD", city: "Bunia" });
  });
  it("reads SmartRecruiters' place (OECD) and Workday's (IRC)", () => {
    expect(factsFromSystem("smartrecruiters", { location: { city: "Paris", country: "fr", fullLocation: "Paris, Île-de-France Region, France" } })).toMatchObject({ countryCode: "FR", city: "Paris" });
    expect(factsFromSystem("workday", { jobPostingInfo: { location: "Louisville, KY USA", country: { descriptor: "United States of America" }, timeType: "Full time" } })).toMatchObject({ countryCode: "US", locationText: "Louisville, KY USA" });
  });
});

describe("JobPosting record and labelled text", () => {
  it("reads validThrough, place and contract type", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"JobPosting","title":"Officer","validThrough":"2026-12-02T23:59:00+01:00","employmentType":["TEMPORARY"],"jobLocation":{"@type":"Place","address":{"addressLocality":"Lyon","addressCountry":"FR"}}}]}</script>`;
    expect(factsFromJobPosting(html)).toMatchObject({ deadline: "2026-12-02", countryCode: "FR", city: "Lyon", locationText: "Lyon, France", jobType: "Temporary", via: "jsonld" });
  });
  it("reads labelled facts from the main content, not the navigation", () => {
    const html = `<html><body><nav>Offices: Kenya, Nigeria, France</nav><main><h1>Finance Officer</h1><p>Duty station: Nairobi, Kenya</p><p>Closing date: 30 November 2026</p></main><footer>Geneva</footer></body></html>`;
    expect(factsFromText("Finance Officer", "https://jobs.example.org/1", html)).toMatchObject({ deadline: "2026-11-30", countryCode: "KE" });
  });
  it("accepts only plausible closing dates", () => {
    const today = new Date("2026-11-12T00:00:00Z");
    expect(plausibleDeadline("2026-12-01", today)).toBe("2026-12-01");
    expect(plausibleDeadline("2020-01-01", today)).toBeNull();
    expect(plausibleDeadline("2029-01-01", today)).toBeNull();
  });
});

describe("job boards with an apply link to the employer", () => {
  it("looks behind UNjobnet listings only when the item has no employer link", () => {
    expect(boardListingOf(item(["https://www.unjobnet.org/jobs/detail/irc-pir-caseworker-90553662"]))).toEqual({
      listing: "https://www.unjobnet.org/jobs/detail/irc-pir-caseworker-90553662",
      apply: "https://www.unjobnet.org/apply/90553662",
    });
    expect(boardListingOf(item(["https://www.rescue.org/job/1", "https://www.unjobnet.org/jobs/detail/x-90553662"]))).toBeNull();
    expect(boardListingOf(item(["https://unjobs.org/vacancies/1794398453314"]))).toBeNull();
  });
});

describe("re-imports keep page facts", () => {
  it("fills only what the feed left empty", () => {
    const j = { deadline: null, countryCode: null, city: null, locationText: null, jobType: "Consultancy", grade: null, minExperienceYears: null, languages: null } as never;
    const merged = withPageFacts(j, { page_deadline: "2026-11-16", page_country_code: "CD", page_city: "Bunia", page_location_text: "Bunia, DR Congo", page_job_type: "Temporary", page_grade: null, page_experience_years: 2, page_languages: ["French"] });
    expect(merged).toMatchObject({ deadline: "2026-11-16", countryCode: "CD", city: "Bunia", jobType: "Consultancy", minExperienceYears: 2, languages: ["French"] });
  });
});

describe("one card per vacancy", () => {
  it("folds identical posts and counts them", async () => {
    const { foldSameVacancies } = await import("@/components/job-card");
    const base = { title: "Senior Finance Associate", org_name: "International Organization for Migration", country_code: "CD", city: "Bunia", location_text: null, deadline: "2026-11-16" };
    const folded = foldSameVacancies([{ ...base, id: 1 }, { ...base, id: 2 }, { ...base, id: 3, deadline: "2026-11-20" }]);
    expect(folded.map((f) => [f.job.id, f.posts])).toEqual([[1, 2], [3, 1]]);
  });
});

describe("more new items than one import reads", () => {
  it("flags a possible gap only when every item is newer than the last import", async () => {
    const { mayHaveGap } = await import("@/lib/feeds/sync");
    const at = (iso: string) => ({ published: iso, updated: null });
    const last = new Date("2026-11-12T00:00:00Z");
    expect(mayHaveGap([at("2026-11-12T01:00:00Z"), at("2026-11-12T02:00:00Z")], 2, last)).toBe(true);
    expect(mayHaveGap([at("2026-11-11T23:00:00Z"), at("2026-11-12T02:00:00Z")], 2, last)).toBe(false);
    expect(mayHaveGap([at("2026-11-12T01:00:00Z")], 2, last)).toBe(false);
    expect(mayHaveGap([at("2026-11-12T01:00:00Z"), at("2026-11-12T02:00:00Z")], 2, null)).toBe(false);
  });
});

describe("still open?", () => {
  it("recognises closed-vacancy wording in the main content only", async () => {
    const { pageSaysClosed, systemSaysClosed } = await import("@/lib/feeds/vacancy-page");
    expect(pageSaysClosed("<main><h1>Finance Officer</h1><p>This position is no longer accepting applications.</p></main>")).toBe(true);
    expect(pageSaysClosed("<main><p>Sorry, the job you are looking for is no longer available.</p></main>")).toBe(true);
    expect(pageSaysClosed("<nav><a>Closed vacancies</a> The position has been filled</nav><main><h1>Finance Officer</h1><p>Apply by sending your CV.</p></main>")).toBe(false);
    expect(systemSaysClosed("smartrecruiters", { active: false })).toBe(true);
    expect(systemSaysClosed("smartrecruiters", { active: true })).toBe(false);
    expect(systemSaysClosed("oracle", { items: [] })).toBe(true);
    expect(systemSaysClosed("workday", {})).toBe(false);
  });
});

describe("closing dates on vacancy pages (labelled text before the record's own expiry)", () => {
  const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const ld = (validThrough: string, extra = "") => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Officer","validThrough":"${validThrough}T09:00:00Z"${extra}}</script>`;

  it("takes the page's labelled closing date over a far-off 'valid through'", () => {
    const html = `<html><body>${ld(day(90))}<main><h1>Officer</h1><p>Internship</p><p>Closing at: ${long(day(14))} - 23:55 CAT</p><p>About the role…</p></main></body></html>`;
    expect(factsFromPage("Officer", "https://jobs.example.org/jobs/officer-123", html)?.deadline).toBe(day(14));
  });

  it("does not believe a 'valid through' more than 75 days ahead, but keeps a near one", () => {
    const page = (d: string) => `<html><body>${ld(d, ',"employmentType":"INTERN"')}<main><h1>Officer</h1><p>About the role.</p></main></body></html>`;
    expect(factsFromPage("Officer", "https://jobs.example.org/jobs/officer-123", page(day(365)))?.deadline ?? null).toBeNull();
    expect(factsFromPage("Officer", "https://jobs.example.org/jobs/officer-123", page(day(20)))?.deadline).toBe(day(20));
  });

  it("finds a labelled date outside the main text and after a line break", () => {
    const html = `<html><body><aside><div>Application Deadline</div>\n<div>${long(day(21))}</div></aside><main><h1>Salesforce SME</h1><p>${"Text about the role. ".repeat(300)}</p></main></body></html>`;
    expect(factsFromPage("Salesforce SME", "https://www.example.org/careers/jobs/salesforce-sme", html)?.deadline).toBe(day(21));
  });

  it("reads a record whose property names are capitalised", () => {
    const html = `<html><body><script type="application/ld+json">{"@context":"http://schema.org","@type":"JobPosting","DatePosted":"${day(-5)}T00:00:00","ValidThrough":"${day(10)}T00:00:00","Title":"Architect"}</script><main><h1>Architect</h1></main></body></html>`;
    expect(factsFromPage("Architect", "https://jobs.example.org/requisition/38983", html)?.deadline).toBe(day(10));
  });
});

describe("general careers pages", () => {
  it("tells a careers page from a vacancy's own page", () => {
    expect(isGeneralCareersPage("https://www.iom.int/iom-job-categories", "Programme Manager (Immigration and Border Governance)")).toBe(true);
    expect(isGeneralCareersPage("https://www.who.int/careers/diversity-equity-and-inclusion", "National Consultant – GEF Project Coordinator")).toBe(true);
    expect(isGeneralCareersPage("https://vacancies.osce.org/", "Senior Procurement Assistant")).toBe(true);
    expect(isGeneralCareersPage("https://www.concern.net/jobs/programme-manager-kenya", "Programme Manager, Kenya")).toBe(false);
    expect(isGeneralCareersPage("https://jobs.jobvite.com/heifer/job/o3K5Afwc", "Asistente Administrativo Contable")).toBe(false);
    expect(isGeneralCareersPage("https://www.ilri.org/jobs?jid=62952-procurement-officer-iii", "Procurement Officer III")).toBe(false);
    expect(applyLinkKind("https://www.iom.int/iom-job-categories", "Programme Manager")).toBe("homepage");
    expect(applyLinkKind("https://www.iom.int/iom-job-categories")).toBe("posting"); // no title to compare with: not guessed
  });

  it("prefers the vacancy's own link when a posting has both", () => {
    const body = `<p>About <a href="https://www.who.int/careers/diversity-equity-and-inclusion">working at WHO</a>.</p><p>How to apply: <a href="https://careers.who.int/careersection/ex/jobdetail.ftl?job=2609876">apply here</a></p>`;
    expect(findEmployerLink(body, "National Consultant – GEF Project Coordinator")).toBe("https://careers.who.int/careersection/ex/jobdetail.ftl?job=2609876");
    const only = `<p>How to apply: see <a href="https://www.iom.int/iom-job-categories">IOM careers</a></p>`;
    expect(findEmployerLink(only, "Programme Manager")).toBe("https://www.iom.int/iom-job-categories");
  });
});

describe("Taleo vacancy pages (hidden initialHistory fields)", () => {
  it("reads the closing date, grade and duty station by their shape", async () => {
    const { factsFromPage } = await import("@/lib/feeds/vacancy-page");
    const fields = ["ftlx0", "descRequisition", "2602337", "Statistician (Statistical Working System)", "13/Nov/2026", "13/Nov/2026", "04/Dec/2026, 11\\:59\\:00 PM", "ESS", "Staff position", "Professional", "P-3", "Italy-Rome", "Fixed-term\\: one year", "!*!<p>We are looking for a statistician with at least five years of experience in official statistics, survey methods and data dissemination for international organizations and member countries.</p>"];
    const html = `<html><body><input type="hidden" name="initialHistory" id="initialHistory" value="${encodeURIComponent(fields.join("!|!"))}"></body></html>`;
    const today = new Date();
    const f = factsFromPage("Statistician (Statistical Working System)", "https://jobs.fao.org/careersection/fao_external/jobdetail.ftl?job=2602337", html);
    expect(f?.via).toBe("taleo");
    expect(f?.grade).toBe("P-3");
    expect(f?.countryCode).toBe("IT");
    expect(f?.city).toBe("Rome");
    // A date more than about a year ahead is never taken; 4 Dec 2026 is within it until late 2027.
    if (today < new Date("2027-11-01")) expect(f?.deadline).toBe("2026-12-04");
  });
});

describe("Taleo pages without a duty station", () => {
  it("takes the country from the office the post belongs to", async () => {
    const { factsFromPage } = await import("@/lib/feeds/vacancy-page");
    const fields = ["ftlx0", "2602334", "Agronomist", "13/Nov/2026", "27/Nov/2026, 11\\:59\\:00 PM", "FEGEO - FAO Representation in Georgia", "Non-staff opportunities", "N/A", "Various Locations"];
    const html = `<input type="hidden" id="initialHistory" value="${encodeURIComponent(fields.join("!|!"))}">`;
    const f = factsFromPage("Agronomist", "https://jobs.fao.org/careersection/fao_external/jobdetail.ftl?job=2602334", html);
    expect(f?.countryCode).toBe("GE");
  });
});
