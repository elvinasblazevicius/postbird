import { describe, expect, it, test } from "vitest";
import { cleanTitle, stripOrgFromTitle, titleForSlug } from "@/lib/feeds/title";
import { slugify } from "@/lib/text";
import { interpretQuery } from "@/lib/search-intent";
import { applyLinkKind } from "@/lib/apply-link";

describe("cleanTitle: gender tags", () => {
  test("strips (F/M), (H/F), (M/F), (m/w/d), (f/m/x) and the like, with a separator they leave behind", () => {
    expect(cleanTitle("Data Analyst (F/M)")).toBe("Data Analyst");
    expect(cleanTitle("Chargé de projet (H/F)")).toBe("Chargé de projet");
    expect(cleanTitle("Project Manager (M/F)")).toBe("Project Manager");
    expect(cleanTitle("Referent (m/w/d) Projektsteuerung")).toBe("Referent Projektsteuerung");
    expect(cleanTitle("Logistics Coordinator (f/m/x)")).toBe("Logistics Coordinator");
    expect(cleanTitle("Advisor (w/m/d) - Berlin")).toBe("Advisor – Berlin");
    expect(cleanTitle("Programme Officer - (m/f/d)")).toBe("Programme Officer");
    expect(cleanTitle("Programme Officer [M/W/D]")).toBe("Programme Officer");
    expect(cleanTitle("Programme Officer ( m / w / d )")).toBe("Programme Officer");
    // Other brackets stay.
    expect(cleanTitle("Monitoring and Evaluation (M&E) Officer (P)")).toBe("Monitoring and Evaluation (M&E) Officer (P)");
    expect(cleanTitle("Officer (WASH/Health)")).toBe("Officer (WASH/Health)");
    expect(cleanTitle("Engineer (M/E)")).toBe("Engineer (M/E)");
  });
});

describe("cleanTitle", () => {
  test("all caps becomes title case, acronyms kept", () => {
    expect(cleanTitle("CLINICAL TRIAL PROJECT MANAGEMENT CONSULTANT")).toBe("Clinical Trial Project Management Consultant");
    expect(cleanTitle("HEAD OF ICT AND DATA - KENYA")).toBe("Head of ICT and Data – Kenya");
  });
  test("leading requisition numbers are removed", () => {
    expect(cleanTitle("23559 Monitoring and Evaluation (M&E) Officer (P)")).toBe("Monitoring and Evaluation (M&E) Officer (P)");
    expect(cleanTitle("REQ-12345 - Data Analyst")).toBe("Data Analyst");
  });
  test("bilingual titles keep the Latin-script part", () => {
    expect(cleanTitle("Field Documentation Officer || موثق/ـة ميداني/ـة")).toBe("Field Documentation Officer");
  });
  test("spaced hyphens between parts of a title become an en dash", () => {
    expect(cleanTitle("Programme Officer- TVET")).toBe("Programme Officer – TVET");
    expect(cleanTitle("Programme Officer -TVET")).toBe("Programme Officer – TVET");
    expect(cleanTitle("Programme Officer - TVET")).toBe("Programme Officer – TVET");
    expect(cleanTitle("Non-Food Items Assistant")).toBe("Non-Food Items Assistant");
    expect(cleanTitle("Pre- and Post-Deployment Adviser")).toBe("Pre- and Post-Deployment Adviser");
    expect(cleanTitle("Officer – Health")).toBe("Officer – Health");
    expect(cleanTitle("Finance Officer -Nairobi")).toBe("Finance Officer – Nairobi");
    expect(cleanTitle("Finance Officer-  Nairobi")).toBe("Finance Officer – Nairobi");
  });
  test("ordinary titles are unchanged", () => {
    expect(cleanTitle("Research Manager")).toBe("Research Manager");
    expect(cleanTitle("2026 Graduate Programme")).toBe("2026 Graduate Programme");
  });
});

describe("titleForSlug", () => {
  const slug = (t: string, ref: string | null = null) => slugify(titleForSlug(cleanTitle(t), ref), 90);
  test("leaves a source's reference number out of the slug", () => {
    expect(slug("VA-2026-045: Finance Officer")).toBe("finance-officer");
    expect(slug("(JO 12345) Finance Officer")).toBe("finance-officer");
    expect(slug("No. 123 – Finance Officer")).toBe("finance-officer");
    expect(slug("UNV-2026-001 - Field Officer")).toBe("field-officer");
    expect(slug("Job Opening ID: 98765 - Analyst")).toBe("analyst");
    expect(slug("ABC-123 Finance Officer", "ABC-123")).toBe("finance-officer");
    expect(slug("23559 Monitoring and Evaluation Officer")).toBe("monitoring-and-evaluation-officer");
  });
  test("keeps titles that only start with a number or code", () => {
    expect(slug("2026 Graduate Programme")).toBe("2026-graduate-programme");
    expect(slug("5G Network Engineer")).toBe("5g-network-engineer");
    expect(slug("P-3 Programme Officer")).toBe("p-3-programme-officer");
    expect(slug("COVID-19 – Response Coordinator")).toBe("covid-19-response-coordinator");
    expect(slug("G5 Sahel Liaison Officer")).toBe("g5-sahel-liaison-officer");
    expect(slug("Finance Officer")).toBe("finance-officer");
  });
});

describe("interpretQuery", () => {
  test("org type, remote, internship and country become filters", () => {
    expect(interpretQuery("un jobs in kenya")).toEqual({ text: null, orgtype: "un", country: "kenya" });
    expect(interpretQuery("remote internship")).toEqual({ text: null, remote: true, type: "Internship" });
    expect(interpretQuery("data analyst vacancies")).toEqual({ text: "data analyst" });
  });
  test("'un' inside other words is not treated as the UN", () => {
    expect(interpretQuery("unicef")).toEqual({ text: "unicef" });
  });
});

describe("applyLinkKind", () => {
  test("recognises forms, homepages and postings", () => {
    expect(applyLinkKind("https://forms.gle/abc")).toBe("form");
    expect(applyLinkKind("https://docs.google.com/forms/d/e/x/viewform")).toBe("form");
    expect(applyLinkKind("https://www.example.org/")).toBe("homepage");
    expect(applyLinkKind("https://example.org/careers")).toBe("homepage");
    expect(applyLinkKind("https://example.org/careers/12345-data-analyst")).toBe("posting");
  });
});

describe("cleanTitle: file names, codes and capitalised runs", () => {
  it("tidies titles seen in real feeds", () => {
    expect(cleanTitle("[pdf] LQ011, Technical Officer.pdf")).toBe("Technical Officer");
    expect(cleanTitle("[pdf] Security Officer (MMF), AX034.pdf")).toBe("Security Officer (MMF)");
    expect(cleanTitle("[pdf] Officer, Partnerships (261645).pdf")).toBe("Officer, Partnerships");
    expect(cleanTitle("​​Quantitative Analyst​ (Entity: EIF – Job ID: 111820)")).toBe("Quantitative Analyst");
    expect(cleanTitle("The European Union Delegation to Kazakhstan is looking for: ACCOUNTS CLERK LOCAL AGENT GROUP III Ref: 160475 – Administration Section"))
      .toBe("Accounts Clerk Local Agent Group III – Administration Section");
    expect(cleanTitle("HRM Assistant – Contract Agent FG III – Job No. 529046")).toBe("HRM Assistant – Contract Agent FG III");
    expect(cleanTitle("Staff Officer (Targeting Support) – NATO 2030")).toBe("Staff Officer (Targeting Support) – NATO 2030");
    expect(cleanTitle("UNICEF WASH Officer")).toBe("UNICEF WASH Officer");
  });
});

describe("stripOrgFromTitle", () => {
  it("removes the organization the source added, never the whole title", () => {
    const iom = ["International Organization for Migration", "IOM", "UN Migration"];
    expect(stripOrgFromTitle("Administrative Assistant | IOM – International Organization for Migration", iom)).toBe("Administrative Assistant");
    expect(stripOrgFromTitle("IOM – Administrative Assistant", iom)).toBe("Administrative Assistant");
    expect(stripOrgFromTitle("UNDP Chief, HR Services", ["UNDP"])).toBe("Chief, HR Services");
    expect(stripOrgFromTitle("Data Analyst at Transparency International (Secretariat)", ["Transparency International"])).toBe("Data Analyst");
    expect(stripOrgFromTitle("IOM", iom)).toBe("IOM");
    expect(stripOrgFromTitle("Migration Officer", iom)).toBe("Migration Officer");
  });
});

describe("vacancy codes and organizations in titles", () => {
  it("drops a vacancy code before a bar", () => {
    expect(cleanTitle("INT 2026 003 | Medical Assistant Intern")).toBe("Medical Assistant Intern");
    expect(cleanTitle("CON 2026 053 | PhilHealth Systems Strengthening Specialist")).toBe("PhilHealth Systems Strengthening Specialist");
  });
});
