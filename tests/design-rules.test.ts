import { describe, expect, it } from "vitest";
import { countryFromStoredPlace, stripAdministeringCountry } from "@/lib/feeds/extract";
import { resultsHeading } from "@/lib/filter-labels";
import { payScaleFor, PAY_SOURCES } from "@/lib/grades";
import { newestFirst } from "@/lib/jobs";
import { weekLead } from "@/components/week-in-review";
import { languagesFromSummary } from "../scripts/reclassify";

describe("country of a stored listing, re-derived", () => {
  it("takes the territory, not the administering country in brackets", () => {
    expect(stripAdministeringCountry("Nouméa, New Caledonia (France)")).toBe("Nouméa, New Caledonia");
    expect(countryFromStoredPlace("Fisheries Adviser", "Nouméa, New Caledonia (France)")).toBe("NC");
    expect(countryFromStoredPlace("Programme Officer", "Nuuk, Greenland (Denmark)")).toBe("GL");
  });

  it("reads one country from the location text or a place-only title segment", () => {
    expect(countryFromStoredPlace("Data Officer", "Nairobi, Kenya")).toBe("KE");
    expect(countryFromStoredPlace("Analyst - Kampala, Uganda", null)).toBe("UG");
    expect(countryFromStoredPlace("Paris Agreement Analyst", null)).toBeNull();
  });

  it("falls back to a known duty station", () => {
    expect(countryFromStoredPlace("Logistics Officer", "Geneva")).toBe("CH");
  });

  it("names no single country for several, or none", () => {
    expect(countryFromStoredPlace("Regional Adviser", "Kenya; Uganda")).toBeNull();
    expect(countryFromStoredPlace("Consultant", "Home-based")).toBeNull();
    expect(countryFromStoredPlace("Consultant", null)).toBeNull();
  });
});

describe("languages re-read from a stored summary", () => {
  it("splits required and desirable languages when the summary names them all", () => {
    const next = languagesFromSummary({
      summary: "Fluency in English is required. Working knowledge of Arabic is an advantage. French is desirable.",
      languages: ["Arabic", "French"],
      desirable_languages: null,
    });
    expect(next).toEqual({ required: null, desirable: ["Arabic", "French"] });
  });

  it("never drops a stored language the excerpt doesn't mention", () => {
    expect(languagesFromSummary({ summary: "Fluency in English is required.", languages: ["Spanish"], desirable_languages: null })).toBeNull();
    expect(languagesFromSummary({ summary: null, languages: null, desirable_languages: null })).toBeNull();
  });
});

describe("results heading", () => {
  const base = { from: 1, to: 20, pages: 3, sort: "newest" as const, showTotal: true };
  it("reads the same everywhere", () => {
    expect(resultsHeading({ ...base, total: 0 })).toBe("No vacancies found");
    expect(resultsHeading({ ...base, total: 1, pages: 1 })).toBe("1 vacancy found");
    expect(resultsHeading({ ...base, total: 5, to: 5, pages: 1 })).toBe("5 vacancies found");
    expect(resultsHeading({ ...base, total: 5, to: 5, pages: 1, showTotal: false })).toBe("5 vacancies found");
    expect(resultsHeading({ ...base, total: 1340, from: 21, to: 40 })).toBe("1,340 vacancies found · showing 21–40");
    expect(resultsHeading({ ...base, total: 45, from: 21, to: 40, showTotal: false, sort: "deadline" })).toBe("Showing 21–40");
  });
});

describe("recently posted order", () => {
  it("lists the chosen listings newest first", () => {
    const d = (s: string) => new Date(s);
    const jobs = [
      { id: 1, published_at: d("2026-11-01"), first_seen_at: d("2026-11-01") },
      { id: 2, published_at: null, first_seen_at: d("2026-11-08") },
      { id: 3, published_at: d("2026-11-05"), first_seen_at: d("2026-11-06") },
      { id: 4, published_at: d("2026-11-05"), first_seen_at: d("2026-11-05") },
    ];
    expect(newestFirst(jobs).map((j) => j.id)).toEqual([2, 4, 3, 1]);
  });
});

describe("pay scales on job pages", () => {
  it("links the ICSC scales for UN grades and the EU tables for EU staff categories", () => {
    expect(payScaleFor({ grade: "P-3", title: "Officer" })?.href).toBe(PAY_SOURCES.icscSalaryScales);
    expect(payScaleFor({ grade: "NO-B", title: "Officer" })?.family).toBe("UN");
    expect(payScaleFor({ grade: "G-5", title: "Assistant" })?.family).toBe("UN");
    expect(payScaleFor({ grade: null, title: "Data Officer (P)" })?.family).toBe("UN");
    expect(payScaleFor({ grade: null, title: "Policy Officer (AD 7)", org_type: "EU institution" })?.href).toBe(PAY_SOURCES.euSalaries);
    expect(payScaleFor({ grade: null, title: "Contract Agent FG IV", org_type: "EU institution" })?.family).toBe("EU");
  });

  it("says nothing when the family isn't known", () => {
    expect(payScaleFor({ grade: "NPSA-8", title: "Analyst" })).toBeNull();
    expect(payScaleFor({ grade: null, title: "Policy Officer (AD 7)", org_type: "NGO" })).toBeNull();
    expect(payScaleFor({ grade: null, title: "Senior Economist" })).toBeNull();
  });
});

describe("this week's lead sentence", () => {
  const week = {
    total: 88,
    types: [{ type: "UN system", count: 40 }, { type: "NGO", count: 30 }],
    orgs: [{ slug: "iom", name: "International Organization for Migration", short_name: "IOM", count: 12 }, { slug: "nrc", name: "Norwegian Refugee Council", short_name: "NRC", count: 9 }],
  };
  it("is built from the numbers only", () => {
    expect(weekLead(week)).toBe("UN system organizations posted 40 of the 88 new vacancies; IOM posted the most of any organization (12).");
    expect(weekLead({ ...week, types: [{ type: "NGO", count: 88 }] })).toBe("All 88 new vacancies came from NGOs; IOM posted the most of any organization (12).");
  });
  it("names no leader on a tie", () => {
    expect(weekLead({ ...week, orgs: [week.orgs[0], { ...week.orgs[1], count: 12 }] })).toBe("UN system organizations posted 40 of the 88 new vacancies.");
    expect(weekLead({ total: 0, types: [], orgs: [] })).toBeNull();
  });
});

describe("what an organization usually posts", () => {
  it("names the contract types and grade groups that make up a good share of its listings", async () => {
    const { usuallyPosts } = await import("@/lib/org-profile");
    expect(usuallyPosts({
      types: [{ k: "Fixed-term", n: 8 }, { k: "Consultancy", n: 4 }, { k: "Internship", n: 1 }],
      grades: [{ k: "P-3", n: 3 }, { k: "P-4", n: 2 }, { k: "P", n: 1 }, { k: "G-5", n: 3 }, { k: "NO-B", n: 1 }],
    })).toBe("fixed-term and consultancy contracts; Professional and General Service grades");
    expect(usuallyPosts({ types: [{ k: "Consultancy", n: 5 }], grades: [{ k: "NPSA-8", n: 3 }, { k: "SB-4", n: 2 }] })).toBe("consultancy contracts; service contracts");
  });

  it("says nothing from too few listings", async () => {
    const { usuallyPosts } = await import("@/lib/org-profile");
    expect(usuallyPosts({ types: [{ k: "Fixed-term", n: 2 }], grades: [] })).toBeNull();
    expect(usuallyPosts({ types: [], grades: [{ k: "P-3", n: 2 }, { k: "P-4", n: 1 }] })).toBe("Professional grades");
  });
});
