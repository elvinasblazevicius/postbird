import { describe, expect, it } from "vitest";
import { applyTarget, isOrgOwnHost, recruitmentSystem } from "@/lib/recruitment-system";

describe("recruitment systems behind application links", () => {
  it("names known applicant-tracking systems by their hostname, subdomains included", () => {
    const cases: [string, string][] = [
      ["fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com", "Oracle"],
      ["spc.taleo.net", "Taleo"],
      ["career5.successfactors.eu", "SuccessFactors"],
      ["jobs.sapsf.com", "SuccessFactors"],
      ["wd3.myworkdayjobs.com", "Workday"],
      ["wd3.myworkdaysite.com", "Workday"],
      ["jobs.smartrecruiters.com", "SmartRecruiters"],
      ["boards.greenhouse.io", "Greenhouse"],
      ["jobs.lever.co", "Lever"],
      ["inspira.un.org", "Inspira"],
      ["careers.un.org", "UN Careers"],
      ["worldbankgroup.csod.com", "Cornerstone"],
      ["nrc.easycruit.com", "Easycruit"],
      ["www.forms.gle", "Google Forms"],
    ];
    for (const [host, label] of cases) expect(recruitmentSystem(host)?.label, host).toBe(label);
  });

  it("matches whole hostname labels only", () => {
    expect(recruitmentSystem("notoraclecloud.com")).toBeNull();
    expect(recruitmentSystem("lever.co.uk")).toBeNull();
    expect(recruitmentSystem("un.org")).toBeNull();
    expect(recruitmentSystem("")).toBeNull();
  });

  it("recognises Google Forms only under /forms on docs.google.com", () => {
    expect(recruitmentSystem("docs.google.com", "/forms/d/e/abc/viewform")).toEqual({ label: "Google Forms", kind: "form" });
    expect(recruitmentSystem("docs.google.com", "/document/d/abc")).toBeNull();
  });
});

describe("the organization's own website", () => {
  it("uses the known organizations' domains and a clear name match", () => {
    expect(isOrgOwnHost("jobs.unicef.org", "UNICEF", "UNICEF")).toBe(true);
    expect(isOrgOwnHost("careers.unesco.org", "UNESCO", "UNESCO")).toBe(true);
    expect(isOrgOwnHost("acted.org", "ACTED", "ACTED")).toBe(true);
    expect(isOrgOwnHost("www.nrc.no", "Norwegian Refugee Council", "NRC")).toBe(true);
    expect(isOrgOwnHost("iom.int", "International Organization for Migration", "IOM")).toBe(true);
  });

  it("never counts a recruitment service or someone else's site", () => {
    expect(isOrgOwnHost("nrc.easycruit.com", "Norwegian Refugee Council", "NRC")).toBe(false);
    expect(isOrgOwnHost("fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com", "International Organization for Migration", "IOM")).toBe(false);
    expect(isOrgOwnHost("example.org", "UNICEF", "UNICEF")).toBe(false);
    expect(isOrgOwnHost("unicef.org", null, null)).toBe(false);
  });
});

describe("the line under the Apply button", () => {
  const iomOracle = "https://fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12345";

  it("names the recruitment system and hides its technical hostname", () => {
    expect(applyTarget({ url: iomOracle, host: "fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com", orgName: "International Organization for Migration", orgShort: "IOM" }))
      .toEqual({ text: "Opens IOM’s recruitment system (Oracle)", host: null });
    expect(applyTarget({ url: "https://careers.un.org/jobSearchDescription/1", host: "careers.un.org", orgName: "United Nations Secretariat", orgShort: "UN" }).text)
      .toBe("Opens the UN’s recruitment system (UN Careers)");
    expect(applyTarget({ url: "https://wbg.csod.com/x", host: "wbg.csod.com", orgName: "World Bank", orgShort: null }).text)
      .toBe("Opens the World Bank’s recruitment system (Cornerstone)");
    expect(applyTarget({ url: "https://spc.taleo.net/x", host: "spc.taleo.net", orgName: null, orgShort: null }).text)
      .toBe("Opens the employer’s recruitment system (Taleo)");
  });

  it("shows the address only for the organization's own site", () => {
    expect(applyTarget({ url: "https://jobs.unicef.org/en-us/job/1", host: "jobs.unicef.org", orgName: "UNICEF", orgShort: "UNICEF" }))
      .toEqual({ text: "Opens UNICEF’s careers site", host: "jobs.unicef.org" });
    expect(applyTarget({ url: "https://www.acted.org/en/careers/", host: "www.acted.org", orgName: "ACTED", orgShort: "ACTED", homepage: true }))
      .toEqual({ text: "Opens ACTED’s careers page", host: "acted.org" });
    expect(applyTarget({ url: "https://jobs.example.net/123", host: "jobs.example.net", orgName: "UNICEF", orgShort: "UNICEF" }))
      .toEqual({ text: "Opens the vacancy on the employer’s website", host: null });
  });

  it("calls a form a form", () => {
    expect(applyTarget({ url: "https://forms.gle/abc", host: "forms.gle", orgName: "ACTED", orgShort: "ACTED" }))
      .toEqual({ text: "Opens an application form (Google Forms)", host: null });
  });
});
