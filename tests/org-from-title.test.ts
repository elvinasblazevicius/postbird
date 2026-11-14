import { describe, expect, it } from "vitest";
import { orgFromTitleAndLink } from "@/lib/feeds/extract";

describe("orgFromTitleAndLink", () => {
  it("takes the title's first word when the link confirms it", () => {
    expect(orgFromTitleAndLink("ECMWF Grants Specialist", "https://jobs.ecmwf.int/Vacancies/123")).toBe("ECMWF");
    expect(orgFromTitleAndLink("CIFF Senior Manager, Girl Capital", "https://apply.workable.com/ciff/j/ABC")).toBe("CIFF");
    expect(orgFromTitleAndLink("Medair Regional Ebola Coordinator", "https://www.medair.org/jobs/x")).toBe("Medair");
  });
  it("never takes a role word or an unconfirmed word", () => {
    expect(orgFromTitleAndLink("Senior Officer", "https://senior.example.org/x")).toBeNull();
    expect(orgFromTitleAndLink("ECMWF Grants Specialist", "https://apply.workable.com/other/j/1")).toBeNull();
    expect(orgFromTitleAndLink("Finance Assistant", "https://jobs.unicef.org/x")).toBeNull();
  });
});

import { linkNamesOrg } from "@/lib/feeds/enrich";
describe("linkNamesOrg", () => {
  it("accepts a name the link spells out", () => {
    expect(linkNamesOrg("https://jobs.jobvite.com/prosperglobal/job/x", "Prosper Global")).toBe(true);
    expect(linkNamesOrg("https://careers.medair.org/x", "Medair")).toBe(true);
  });
  it("refuses a name the link doesn't carry", () => {
    expect(linkNamesOrg("https://jobs.jobvite.com/prosperglobal/job/x", "Mercy Corps")).toBe(false);
    expect(linkNamesOrg("https://apply.workable.com/ciff/j/1", "UNICEF")).toBe(false);
  });
});

import { placeFromTitle } from "@/lib/feeds/extract";
describe("placeFromTitle", () => {
  it("reads a trailing place", () => {
    expect(placeFromTitle("Technology for Development Specialist (NO-3), Maseru – Lesotho, ESAR")?.countryCode).toBe("LS");
    expect(placeFromTitle("Finance Officer – Nairobi")?.countryCode).toBe("KE");
    expect(placeFromTitle("Finance Officer")).toBeNull();
  });
});
