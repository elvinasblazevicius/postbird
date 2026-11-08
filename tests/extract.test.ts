import { describe, expect, it } from "vitest";
import { extractDeadline, findDate } from "@/lib/feeds/dates";
import { detectCategory, detectJobType, findCountries, normalizeItem, type FeedContext } from "@/lib/feeds/extract";
import { parseFeed, type RawItem } from "@/lib/feeds/parse";
import { canonicalizeUrl, pickApplyUrl } from "@/lib/feeds/url";

const feed: FeedContext = { id: 1, name: "Test", defaultOrganization: null, contentPolicy: "none" };

function raw(partial: Partial<RawItem>): RawItem {
  return {
    guid: null, title: "", links: ["https://jobs.example.org/1"], summaryHtml: null, contentHtml: null,
    published: "Mon, 02 Nov 2026 10:00:00 GMT", updated: null, author: null, categories: [], sourceTitle: null, sourceUrl: null,
    ...partial,
  };
}

describe("dates", () => {
  it("reads common unambiguous formats", () => {
    expect(findDate("15 November 2026")).toBe("2026-11-15");
    expect(findDate("Friday, November 20, 2026")).toBe("2026-11-20");
    expect(findDate("20-Nov-2026")).toBe("2026-11-20");
    expect(findDate("2026-12-01")).toBe("2026-12-01");
    expect(findDate("25/11/2026")).toBe("2026-11-25");
    expect(findDate("30.11.2026")).toBe("2026-11-30");
    expect(findDate("15 novembre 2026")).toBe("2026-11-15");
    expect(findDate("1er décembre 2026")).toBe("2026-12-01");
  });
  it("refuses ambiguous or invalid dates", () => {
    expect(findDate("05/06/2026")).toBeNull();
    expect(findDate("31 February 2026")).toBeNull();
    expect(findDate("next Friday")).toBeNull();
  });
  it("only takes deadlines that are labelled", () => {
    expect(extractDeadline("Closing date: 15 November 2026 (11:59 PM New York time)")).toBe("2026-11-15");
    expect(extractDeadline("Deadline for applications - 3 Dec 2026")).toBe("2026-12-03");
    expect(extractDeadline("Contract end date: 31 December 2027")).toBeNull();
    expect(extractDeadline("Posted 1 November 2026. Duration 6 months.")).toBeNull();
  });
});

describe("classification", () => {
  it("assigns categories from the title", () => {
    expect(detectCategory("Data Analyst (P-3)")).toBe("data-analytics");
    expect(detectCategory("Programme Officer, Child Protection")).toBe("programme-management");
    expect(detectCategory("Finance and Administration Associate")).toBe("finance");
    expect(detectCategory("Senior Statistician")).toBe("data-analytics");
    expect(detectCategory("HR Business Partner")).toBe("human-resources");
    expect(detectCategory("Driver")).toBe("administration");
    expect(detectCategory("Chief of Field Office")).toBe("other");
  });
  it("detects job types only from explicit words", () => {
    expect(detectJobType("Internship - Communications")).toBe("Internship");
    expect(detectJobType("International Consultant for evaluation")).toBe("Consultancy");
    expect(detectJobType("Temporary Appointment")).toBe("Temporary");
    expect(detectJobType("Programme Officer")).toBeNull();
  });
  it("matches countries and aliases without overlaps", () => {
    expect(findCountries("Kinshasa, DRC")).toEqual(["CD"]);
    expect(findCountries("Brazzaville, Congo")).toEqual(["CG"]);
    expect(findCountries("Democratic Republic of the Congo")).toEqual(["CD"]);
    expect(findCountries("Bissau, Guinea-Bissau")).toEqual(["GW"]);
    expect(findCountries("Niger")).toEqual(["NE"]);
    expect(findCountries("Nigeria")).toEqual(["NG"]);
  });
});

describe("normalizeItem", () => {
  it("extracts labelled facts from a ReliefWeb-style description", () => {
    const job = normalizeItem(
      raw({
        title: "Information Management Officer",
        summaryHtml:
          "<p>Organization: United Nations Children's Fund</p><p>Country: South Sudan</p><p>City: Juba</p><p>Closing date: 26 Nov 2026</p><p>The officer will...</p>",
      }),
      feed,
    );
    expect(job.organization?.name).toBe("UNICEF");
    expect(job.countryCode).toBe("SS");
    expect(job.city).toBe("Juba");
    expect(job.deadline).toBe("2026-11-26");
    expect(job.category).toBe("data-analytics");
    expect(job.summary).toBeNull(); // policy "none"
    expect(job.descriptionHtml).toBeNull();
  });

  it("leaves unknown fields empty instead of guessing", () => {
    const job = normalizeItem(raw({ title: "Coordinator", summaryHtml: "<p>We work in Kenya, Uganda and Ethiopia.</p>" }), feed);
    expect(job.organization).toBeNull();
    expect(job.countryCode).toBeNull();
    expect(job.city).toBeNull();
    expect(job.deadline).toBeNull();
    expect(job.isRemote).toBeNull();
    expect(job.jobType).toBeNull();
  });

  it("reads location and grade from the title and organization from the link domain", () => {
    const job = normalizeItem(
      raw({ title: "Data Scientist, P3 - Geneva", links: ["https://www.inoreader.com/article/abc", "https://careers.who.int/job/123?utm_source=rss"] }),
      feed,
    );
    expect(job.applyUrl).toBe("https://careers.who.int/job/123?utm_source=rss");
    expect(job.organization?.short).toBe("WHO");
    expect(job.city).toBe("Geneva");
    expect(job.countryCode).toBe("CH");
    expect(job.grade).toBe("P-3");
  });

  it("detects home-based roles and multi-country postings", () => {
    const job = normalizeItem(raw({ title: "Consultant (home-based)", summaryHtml: "<p>Duty Station: Home-based</p>" }), feed);
    expect(job.isRemote).toBe(true);
    expect(job.jobType).toBe("Consultancy");
    const multi = normalizeItem(raw({ title: "Field Officer", summaryHtml: "<p>Location: Amman, Jordan; Beirut, Lebanon</p>" }), feed);
    expect(multi.countryCode).toBeNull();
    expect(multi.locationText).toContain("Jordan");
  });

  it("stores an excerpt or full text only when the feed allows it", () => {
    const html = "<p>" + "Responsible for the analysis of programme data and reporting. ".repeat(20) + "</p><script>alert(1)</script>";
    const ex = normalizeItem(raw({ title: "Analyst", contentHtml: html }), { ...feed, contentPolicy: "excerpt" });
    expect(ex.summary!.length).toBeLessThanOrEqual(301);
    expect(ex.descriptionHtml).toBeNull();
    const full = normalizeItem(raw({ title: "Analyst", contentHtml: html }), { ...feed, contentPolicy: "full" });
    expect(full.descriptionHtml).toContain("<p>");
    expect(full.descriptionHtml).not.toContain("script");
  });

  it("ignores implausible deadlines and future publish dates", () => {
    const job = normalizeItem(raw({ title: "Analyst", summaryHtml: "Deadline: 1 January 2020", published: "2099-01-01T00:00:00Z" }), feed);
    expect(job.publishedAt).toBeNull();
    expect(job.deadline).toBeNull();
  });

  it("skips items without title or link", () => {
    expect(() => normalizeItem(raw({ title: "" }), feed)).toThrow();
    expect(() => normalizeItem(raw({ title: "X", links: [] }), feed)).toThrow();
  });
});

describe("urls", () => {
  it("canonicalizes for duplicate detection", () => {
    expect(canonicalizeUrl("http://WWW.Example.org/jobs/12/?utm_source=x&b=2&a=1#top")).toBe("https://example.org/jobs/12?a=1&b=2");
  });
  it("prefers the employer link over feed-reader links", () => {
    expect(pickApplyUrl(["https://www.inoreader.com/x", "https://jobs.undp.org/1"])).toBe("https://jobs.undp.org/1");
  });
});

describe("parseFeed", () => {
  it("parses RSS, Atom and JSON Feed", () => {
    const rss = parseFeed(`<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title>
      <item><title><![CDATA[Analyst &amp; Officer]]></title><link>https://a.org/1</link><dc:creator>UNDP</dc:creator><category>Kenya</category><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
    expect(rss.items[0].title).toBe("Analyst &amp; Officer");
    expect(rss.items[0].author).toBe("UNDP");
    expect(rss.items[0].categories).toEqual(["Kenya"]);
    const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><id>x</id><title>T2</title><link rel="alternate" href="https://b.org/2"/><updated>2026-11-02T00:00:00Z</updated><author><name>OECD</name></author></entry></feed>`);
    expect(atom.items[0].links).toEqual(["https://b.org/2"]);
    expect(atom.items[0].author).toBe("OECD");
    const json = parseFeed(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "J", items: [{ id: "1", url: "https://c.org/3", title: "T3", content_html: "<p>x</p>", date_published: "2026-11-02T00:00:00Z", authors: [{ name: "WFP" }] }] }));
    expect(json.items[0].links).toEqual(["https://c.org/3"]);
    expect(json.items[0].author).toBe("WFP");
  });
  it("explains bad input", () => {
    expect(() => parseFeed("<html><body>Login</body></html>")).toThrow(/web page/);
    expect(() => parseFeed("")).toThrow(/empty/);
    expect(() => parseFeed("{bad json")).toThrow(/JSON/);
  });
});

import { detectExperienceYears, detectLanguages } from "@/lib/feeds/extract";

describe("requirements", () => {
  it("finds languages only in language-requirement sentences", () => {
    expect(detectLanguages("Fluency in English and French is required. Knowledge of Arabic is an asset.")).toEqual(["Arabic", "French"]);
    expect(detectLanguages("The office in French Polynesia covers the region. Fluency in English is required.")).toBeNull();
    expect(detectLanguages("Duty station: Paris. We value diversity.")).toBeNull();
  });
  it("reads minimum years of experience", () => {
    expect(detectExperienceYears("A minimum of five (5) years of progressively responsible experience in data analysis")).toBe(5);
    expect(detectExperienceYears("At least 2 years of relevant professional experience is required.")).toBe(2);
    expect(detectExperienceYears("Experience with Python is an asset.")).toBeNull();
  });
});

describe("review regressions", () => {
  it("does not take unrelated dates as deadlines", () => {
    expect(extractDeadline("Works in a deadline-driven environment. Start date: 1 January 2027")).toBeNull();
    expect(extractDeadline("Deadline extended from 10 November 2026 to 30 November 2026")).toBe("2026-11-30");
    expect(extractDeadline("Applications close on 15 November. Posted 1 December 2026")).toBeNull();
    expect(extractDeadline("Closing date: 15 Nov. 2026 (midnight)")).toBe("2026-11-15");
  });
});

describe("review regressions: extraction", () => {
  const f: FeedContext = { id: 1, name: "T", defaultOrganization: null, contentPolicy: "none" };
  const r = (p: Partial<RawItem>): RawItem => ({ guid: null, title: "X", links: ["https://jobs.example.org/9"], summaryHtml: null, contentHtml: null, published: null, updated: null, author: null, categories: [], sourceTitle: null, sourceUrl: null, ...p });
  it("ignores working-language boilerplate and durations", () => {
    expect(detectLanguages("English and French are the working languages of the United Nations Secretariat.")).toBeNull();
    expect(detectExperienceYears("Duration: 2 years (renewable), experience in GIS")).toBeNull();
    expect(detectExperienceYears("Minimum experience of 3 years in finance")).toBe(3);
  });
  it("reads grades only where they are clearly grades", () => {
    expect(normalizeItem(r({ title: "Coordinator, G7 Summit Secretariat" }), f).grade).toBeNull();
    expect(normalizeItem(r({ title: "Data Analyst (P-3)" }), f).grade).toBe("P-3");
    expect(normalizeItem(r({ title: "Data Scientist, P3 - Geneva" }), f).grade).toBe("P-3");
  });
  it("does not read places out of ordinary words", () => {
    const a = normalizeItem(r({ title: "Climate Advisor (Paris Agreement)" }), f);
    expect(a.city).toBeNull();
    expect(a.countryCode).toBeNull();
    expect(normalizeItem(r({ title: "Field Officer - New Mexico" }), f).countryCode).toBeNull();
    expect(normalizeItem(r({ title: "Analyst - Georgia" }), f).countryCode).toBeNull();
    expect(normalizeItem(r({ title: "Analyst", categories: ["Jordan Smith"] }), f).countryCode).toBeNull();
    expect(normalizeItem(r({ title: "Analyst", categories: ["Kenya"] }), f).countryCode).toBe("KE");
    expect(normalizeItem(r({ title: "Analyst", summaryHtml: "<p>Duty station: Country Office, Kenya</p>" }), f).city).toBeNull();
    expect(normalizeItem(r({ title: "Analyst", summaryHtml: "<p>City: TBD</p><p>Country: Kenya</p>" }), f).city).toBeNull();
  });
});
