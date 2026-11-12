import { describe, expect, it } from "vitest";
import { parseRobots, robotsAllows } from "@/lib/feeds/robots";
import { factsFromJobPosting, factsFromSystem, factsFromText, oracleApiUrl, plausibleDeadline, smartRecruitersApiUrl, workdayApiUrl } from "@/lib/feeds/vacancy-page";
import { boardListingOf } from "@/lib/feeds/board-links";
import { withPageFacts } from "@/lib/feeds/sync";
import type { RawItem } from "@/lib/feeds/parse";

const item = (links: string[]): RawItem => ({ guid: null, title: "IRC PIR Caseworker", links, summaryHtml: null, contentHtml: null, published: null, updated: null, author: null, categories: [], sourceTitle: null, sourceUrl: null });

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
