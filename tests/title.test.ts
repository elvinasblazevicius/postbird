import { describe, expect, test } from "vitest";
import { cleanTitle } from "@/lib/feeds/title";
import { interpretQuery } from "@/lib/search-intent";
import { applyLinkKind } from "@/lib/apply-link";

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
  });
  test("ordinary titles are unchanged", () => {
    expect(cleanTitle("Research Manager")).toBe("Research Manager");
    expect(cleanTitle("2026 Graduate Programme")).toBe("2026 Graduate Programme");
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
