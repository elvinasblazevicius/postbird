import { describe, expect, it } from "vitest";
import { extractDeadline, findDate } from "@/lib/feeds/dates";
import { detectCategory, detectJobType, findCountries, normalizeItem, type FeedContext } from "@/lib/feeds/extract";
import { parseFeed, type RawItem } from "@/lib/feeds/parse";
import { canonicalizeUrl, pickApplyUrl } from "@/lib/feeds/url";
import { sanitizeDescription, sanitizeDescriptionMax } from "@/lib/text";

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
    expect(detectCategory("Programme Officer, Child Protection")).toBe("protection-humanitarian-affairs");
    expect(detectCategory("Finance and Administration Associate")).toBe("finance");
    expect(detectCategory("Senior Statistician")).toBe("data-analytics");
    expect(detectCategory("HR Business Partner")).toBe("human-resources");
    expect(detectCategory("Driver")).toBe("administration");
    expect(detectCategory("Chief of Field Office")).toBe("programme-management");
    expect(detectCategory("Cartographer")).toBe("other");
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

  it("caps a very long full description without leaving broken HTML", () => {
    const para = (i: number) => `<p>Paragraph ${i} with <strong>bold &amp; important</strong> and <a href="https://example.org/${i}">a link</a> &lt;here&gt;.</p>`;
    // Deep nesting, so a plain cut would leave several tags open.
    const html = `<blockquote><ul><li>${Array.from({ length: 2000 }, (_, i) => para(i)).join("")}</li></ul></blockquote>`;
    const job = normalizeItem(raw({ title: "Analyst", contentHtml: html }), { ...feed, contentPolicy: "full" });
    const d = job.descriptionHtml!;
    expect(d.length).toBeGreaterThan(50_000);
    expect(d.length).toBeLessThanOrEqual(60_000);
    // Well-formed: sanitizing again changes nothing, every tag is closed, and the end isn't a cut tag or entity.
    expect(sanitizeDescription(d)).toBe(d);
    for (const tag of ["blockquote", "ul", "li", "p", "strong", "a"]) {
      const opened = d.match(new RegExp(`<${tag}[\\s>]`, "g"))?.length ?? 0;
      expect(d.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0).toBe(opened);
    }
    expect(d).toMatch(/<\/blockquote>$/);
    expect(d).not.toMatch(/&[#\w]*$|<[^>]*$/);
    // Cuts at every position stay well-formed too.
    for (let max = 40; max < 400; max += 7) {
      const short = sanitizeDescriptionMax(html, max);
      expect(short.length).toBeLessThanOrEqual(max);
      expect(sanitizeDescription(short)).toBe(short);
    }
  });

  it("links in full descriptions open in a new tab with rel=nofollow noopener noreferrer, whatever the source said", () => {
    const d = sanitizeDescription(`<p>Apply at <a href="https://example.org/apply" rel="opener" target="_self" onclick="steal()">the site</a>.</p>`);
    expect(d).toBe(`<p>Apply at <a href="https://example.org/apply" rel="nofollow noopener noreferrer" target="_blank">the site</a>.</p>`);
    expect(sanitizeDescription(d)).toBe(d);
    // Unsafe schemes are still dropped.
    expect(sanitizeDescription(`<p><a href="javascript:alert(1)">x</a></p>`)).not.toContain("javascript");
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

import { detectExperienceYears, detectLanguageRequirements, detectLanguages } from "@/lib/feeds/extract";

describe("requirements", () => {
  it("finds languages only in language-requirement sentences", () => {
    expect(detectLanguages("Fluency in English and French is required. Knowledge of Arabic is an asset.")).toEqual(["French"]);
    expect(detectLanguageRequirements("Fluency in English and French is required. Knowledge of Arabic is an asset.")).toEqual({ required: ["French"], desirable: ["Arabic"] });
    expect(detectLanguages("The office in French Polynesia covers the region. Fluency in English is required.")).toBeNull();
    expect(detectLanguages("Duty station: Paris. We value diversity.")).toBeNull();
  });
  it("skips lists of UN official languages and keeps desirable languages apart", () => {
    const none = { required: null, desirable: null };
    // IOM's wording: any one of the other official languages is a plus, so no language is named.
    expect(detectLanguageRequirements("Working knowledge of another official UN language (Arabic, Chinese, French, Russian and Spanish) is an advantage.")).toEqual(none);
    expect(detectLanguageRequirements("Working knowledge of another official UN language (Arabic, Chinese, French, Russian and Spanish) is required.")).toEqual(none);
    expect(detectLanguageRequirements("Knowledge of another United Nations language, such as Arabic or Spanish, is an asset.")).toEqual(none);
    expect(detectLanguageRequirements("Knowledge of another UN official language (e.g. Arabic, Chinese) is desirable.")).toEqual(none);
    expect(detectLanguageRequirements(
      "Fluency in English is required. Working knowledge of French is an advantage. Working knowledge of another official UN language (Arabic, Chinese, Russian and Spanish) is an advantage.",
    )).toEqual({ required: null, desirable: ["French"] });
    expect(detectLanguageRequirements("Fluency in English and French is required; knowledge of another UN language (Arabic, Spanish) is an asset.")).toEqual({ required: ["French"], desirable: null });
    expect(detectLanguageRequirements("Proficiency in French is required, and knowledge of Arabic or Spanish would be an advantage.")).toEqual({ required: ["French"], desirable: ["Arabic", "Spanish"] });
    expect(detectLanguageRequirements("Desirable: knowledge of Portuguese.")).toEqual({ required: null, desirable: ["Portuguese"] });
    expect(detectLanguageRequirements("Languages: Spanish (preferred).")).toEqual({ required: null, desirable: ["Spanish"] });
    expect(detectLanguageRequirements("Fluency in Arabic is essential. Arabic and French are an asset.")).toEqual({ required: ["Arabic"], desirable: ["French"] });
  });

  it("reads minimum years of experience", () => {
    expect(detectExperienceYears("A minimum of five (5) years of progressively responsible experience in data analysis")).toBe(5);
    expect(detectExperienceYears("At least 2 years of relevant professional experience is required.")).toBe(2);
    expect(detectExperienceYears("Experience with Python is an asset.")).toBeNull();
  });

  it("reads the shorter ways of writing years of experience", () => {
    expect(detectExperienceYears("5+ years experience in humanitarian logistics")).toBe(5);
    expect(detectExperienceYears("Requires a minimum of 3 years' experience in finance.")).toBe(3);
    expect(detectExperienceYears("At least 7 years’ relevant experience")).toBe(7);
    expect(detectExperienceYears("Experience: 5 years minimum")).toBe(5);
    expect(detectExperienceYears("Work experience: at least 3 years in M&E")).toBe(3);
    expect(detectExperienceYears("Ten years professional experience")).toBe(10);
    // Durations are still not requirements.
    expect(detectExperienceYears("Duration: 2 years contract with experience in GIS an asset")).toBeNull();
    expect(detectExperienceYears("A 2 years assignment; experience in GIS")).toBeNull();
  });

  it("reads languages written as mandatory, must or speak", () => {
    expect(detectLanguageRequirements("French is mandatory for this post.")).toEqual({ required: ["French"], desirable: null });
    expect(detectLanguageRequirements("Must speak Arabic.")).toEqual({ required: ["Arabic"], desirable: null });
    expect(detectLanguageRequirements("Candidates must be able to speak and write Portuguese.")).toEqual({ required: ["Portuguese"], desirable: null });
    expect(detectLanguageRequirements("Spoken Russian is an advantage.")).toEqual({ required: null, desirable: ["Russian"] });
    expect(detectLanguageRequirements("You speak Spanish; Chinese is an asset.")).toEqual({ required: ["Spanish"], desirable: ["Chinese"] });
  });

  it("still leaves places and organization-wide language lists alone", () => {
    expect(detectLanguages("Experience in Spanish-speaking countries is required.")).toBeNull();
    expect(detectLanguages("Must have worked in French speaking West Africa.")).toBeNull();
    expect(detectLanguages("You must submit your application by the deadline. The office is in French Polynesia.")).toBeNull();
    expect(detectLanguageRequirements("Working knowledge of another official UN language (Arabic, Chinese, French, Russian and Spanish) is an advantage.")).toEqual({ required: null, desirable: null });
    expect(detectLanguageRequirements("Fluency in English and French is mandatory; another UN language (Arabic, Spanish) is an asset.")).toEqual({ required: ["French"], desirable: null });
    expect(detectLanguages("English and French are the working languages of the United Nations Secretariat. Staff must speak English.")).toBeNull();
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
  it("stores required and desirable languages apart, and IOM's (P) is no grade", () => {
    const m = normalizeItem(r({
      title: "Programme Officer (P)",
      contentHtml: "<p>Fluency in English and Spanish is required.</p><p>Working knowledge of another official UN language (Arabic, Chinese, French, Russian and Spanish) is an advantage.</p><p>Knowledge of Portuguese is desirable.</p>",
    }), f);
    expect(m.grade).toBeNull();
    expect(m.languages).toEqual(["Spanish"]);
    expect(m.desirableLanguages).toEqual(["Portuguese"]);
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

import { isSuspendedInoreaderFeed } from "@/lib/feeds/sync";
import { isListingSite } from "@/lib/feeds/url";
import { cleanLink, domainMatchesOrg, findEmployerLink } from "@/lib/feeds/employer-link";

/** Synthetic items shaped like real ReliefWeb / Inoreader feed items (text written for the tests). */
function board(title: string, tags: string, body = '<p>About the role.</p><p>How to apply</p><p><a href="https://careers.example-ngo.org/jobs/77">Apply here</a></p>'): RawItem {
  return raw({ title, links: ["https://reliefweb.int/job/1/x"], summaryHtml: `${tags}${body}` });
}

describe("real-feed regressions (ReliefWeb and Inoreader)", () => {
  it("skips tenders and supplier calls, keeps jobs", () => {
    for (const t of ["Request for Proposal Website Redesign", "Request for Offers: Event Services", "RFQ - Office furniture", "Invitation to Bid for vehicles", "Translators - invitation to join our preferred supplier list"]) {
      expect(() => normalizeItem(board(t, '<div class="tag country">Country: Kenya</div>'), feed)).toThrow(/tender|supplier/);
    }
    expect(normalizeItem(board("Procurement Officer (Tenders)", '<div class="tag country">Country: Kenya</div>'), feed).title).toBe("Procurement Officer (Tenders)");
  });

  it("maps 'UN …' and 'Program' spellings to the known organization", () => {
    const a = normalizeItem(board("Programme Assistant", '<div class="tag source">Organization: UN Human Settlements Program</div>'), feed);
    expect(a.organization?.short).toBe("UN-Habitat");
    const b = normalizeItem(board("Education Officer", '<div class="tag source">Organization: UN Educational, Scientific and Cultural Organization</div>'), feed);
    expect(b.organization?.short).toBe("UNESCO");
  });

  it("reads territories and multi-country postings", () => {
    const t = normalizeItem(board("Logistics Officer", '<div class="tag country">Country: Martinique (France)</div>'), feed);
    expect(t.countryCode).toBe("MQ");
    const m = normalizeItem(board("Regional Consultant", '<div class="tag country">Countries: Argentina, Bolivia (Plurinational State of), Brazil</div>', '<p>Location: Latin America</p><p>How to apply: <a href="https://jobs.example.org/9">apply</a></p>'), feed);
    expect(m.countryCode).toBeNull();
    expect(m.locationText).toBe("Argentina, Bolivia, Brazil");
  });

  it("takes the lower end of an experience range and ignores languages that are not requirements", () => {
    expect(detectExperienceYears("At least 3-5 years of relevant working experience in a humanitarian setting")).toBe(3);
    expect(detectLanguages("We aim to improve the Arabic-language experience of our bilingual website.")).toBeNull();
    expect(detectLanguages("Fluency in Arabic. Good command of English is an asset.")).toEqual(["Arabic"]);
    expect(detectLanguages("Languages: Spanish and English.")).toEqual(["Spanish"]);
  });

  it("never uses a feed-reader link as the vacancy link", () => {
    expect(pickApplyUrl(["https://www.inoreader.com/blog/2019/02/x.html"])).toBeNull();
  });

  it("recognises a suspended Inoreader feed", () => {
    const notice = raw({ guid: "https://www.inoreader.com/upgrade/feature/rss_common?post", title: "Feed suspended! Please contact the owner.", links: ["https://www.inoreader.com/blog/2019/02/x.html"] });
    expect(isSuspendedInoreaderFeed([notice])).toBe(true);
    expect(isSuspendedInoreaderFeed([raw({ title: "Feed suspended! (a film festival job)", links: ["https://jobs.example.org/2"] })])).toBe(false);
  });

  it("recognises job boards", () => {
    expect(isListingSite("reliefweb.int")).toBe(true);
    expect(isListingSite("jobs.undp.org")).toBe(false);
  });

  it("categorises plural and non-English titles", () => {
    expect(detectCategory("Sign Language Interpreters - Kenya")).toBe("communications");
    expect(detectCategory("Oficial de Cadena de Abastecimiento y Compras")).toBe("procurement-logistics");
    expect(detectCategory("Technical Officer (Cold Chain)")).toBe("procurement-logistics");
  });
});

describe("employer links (job boards are never linked)", () => {
  const tags = '<div class="tag country">Country: Kenya</div><div class="tag source">Organization: Concern Worldwide</div>';
  it("links to the employer's application page from the How to apply section", () => {
    const body = '<p>See <a href="https://www.concern.net/">our website</a>.</p><h3>How to apply</h3><p><a href="https://jobs.concern.net/careers-home/jobs/1166?lang=en-gb">Apply online</a></p>';
    const j = normalizeItem(board("Programme Manager", tags, body), feed);
    expect(j.applyUrl).toBe("https://jobs.concern.net/careers-home/jobs/1166?lang=en-gb");
    expect(j.applyHost).toBe("jobs.concern.net");
    expect(j.sourceHost).toBe("reliefweb.int");
    expect(j.organization?.website).toBe("concern.net");
  });
  it("unwraps Outlook Safe Links and markdown leftovers, and skips documents", () => {
    expect(cleanLink("https://fra01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fx.teamtailor.com%2Fjobs%2F1&amp;data=abc")).toBe("https://x.teamtailor.com/jobs/1");
    expect(cleanLink("https://candidate.hr-manager.net/ApplicationInit.aspx?cid=1**](https://other")).toBe("https://candidate.hr-manager.net/ApplicationInit.aspx?cid=1");
    const body = '<p>How to apply</p><p><a href="https://example.org/files/ToR.pdf">Terms of reference</a> <a href="https://forms.gle/abc123">Application form</a></p>';
    expect(findEmployerLink(body)).toBe("https://forms.gle/abc123");
    expect(findEmployerLink('<p>How to apply</p><a href="https://careers.example.org/jobs/8?promotion=22-trackable-share-link-reliefweb&amp;lang=en">Apply</a>'))
      .toBe("https://careers.example.org/jobs/8?lang=en");
  });
  it("prefers an application form over shared documents, and skips procurement notices", () => {
    const body = '<p>How to apply</p><p>Submit the <a href="https://docs.google.com/document/d/abc/edit">application form</a> via <a href="https://forms.gle/xyz">this form</a></p>';
    expect(findEmployerLink(body)).toBe("https://forms.gle/xyz");
    const tender = '<p>How to apply</p><p>Apply here: <a href="https://www.ungm.org/Public/Notice/1">notice</a></p>';
    expect(() => normalizeItem(board("Event services", tags, tender), feed)).toThrow(/procurement/);
  });
  it("skips job-board items that only give an email address", () => {
    const body = "<p>How to apply</p><p>Send your CV to jobs@example.org</p>";
    expect(() => normalizeItem(board("Driver", tags, body), feed)).toThrow(/employer/);
  });
  it("matches organization websites by name or acronym only", () => {
    expect(domainMatchesOrg("drc.ngo", "Danish Refugee Council")).toBe(true);
    expect(domainMatchesOrg("blueventures.org", "Blue Ventures")).toBe(true);
    expect(domainMatchesOrg("medecinsdumonde.org", "Médecins du Monde")).toBe(true);
    expect(domainMatchesOrg("impact-initiatives.org", "Agency for Technical Cooperation and Development")).toBe(false);
    expect(domainMatchesOrg("google.com", "World Health Organization")).toBe(false);
  });
});
