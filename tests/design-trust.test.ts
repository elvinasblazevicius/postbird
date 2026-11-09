/**
 * Without a database: the coverage wording (no claim of every vacancy), the employer-type intro
 * computed from the listings, the closing-date postmark's words, and the employer menu shown when
 * the counts can't be checked (static pages built at deploy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closingStamp } from "@/components/postmark";
import { UNCHECKED_EMPLOYER_NAV } from "@/components/site-header";
import { COVERAGE_CAVEAT, oneEmailLine } from "@/lib/coverage";
import { postingProfile } from "@/lib/org-profile";

describe("coverage wording", () => {
  it("says what we find, never every vacancy", () => {
    expect(oneEmailLine({ count: 120, names: ["IOM", "WHO", "UNESCO", "UNICEF"] })).toBe(
      "One email with the new vacancies we find from IOM, WHO, UNESCO and 117 other organizations, so you check fewer career sites.",
    );
    expect(oneEmailLine({ count: 4, names: ["IOM", "WHO", "UNESCO"] })).toBe(
      "One email with the new vacancies we find from IOM, WHO, UNESCO and 1 other organization, so you check fewer career sites.",
    );
    expect(oneEmailLine({ count: 3, names: ["IOM", "WHO", "UNESCO"] })).toBe("One email with the new vacancies we find from IOM, WHO and UNESCO, so you check fewer career sites.");
    expect(oneEmailLine(null)).toBe("One email with the new vacancies we find, so you check fewer career sites.");
    expect(COVERAGE_CAVEAT).toBe("We list the vacancies our sources publish, which may not be all of an organization's vacancies. For a specific employer, also check its own careers site.");
  });
});

describe("employer-type intro", () => {
  it("names the largest fields and what is usual, from the counts", () => {
    const line = postingProfile({
      categories: [
        { slug: "health", name: "Health", count: 9 },
        { slug: "it", name: "IT", count: 5 },
        { slug: "other", name: "Other", count: 20 },
        { slug: "logistics", name: "Logistics", count: 4 },
        { slug: "legal", name: "Legal", count: 1 },
      ],
      types: [{ job_type: "Fixed-term", count: 12 }, { job_type: "Consultancy", count: 2 }],
      grades: [{ grade: "P-3", count: 6 }, { grade: "P-4", count: 3 }],
    });
    expect(line).toBe("The largest fields right now are health, IT and logistics. Usually fixed-term contracts; Professional grades.");
  });

  it("keeps category names that contain \"and\" readable", () => {
    const line = postingProfile({
      categories: [
        { slug: "data-analytics", name: "Data and analytics", count: 5 },
        { slug: "finance", name: "Finance", count: 4 },
        { slug: "procurement-logistics", name: "Procurement and logistics", count: 3 },
      ],
      types: [],
      grades: [],
    });
    expect(line).toBe("The largest fields right now are data and analytics, finance, and procurement and logistics.");
  });

  it("says nothing with too few listings", () => {
    expect(postingProfile({ categories: [{ slug: "health", name: "Health", count: 2 }], types: [], grades: [] })).toBeNull();
  });
});

describe("closing-date postmark", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows the date, the year when it isn't this year, and the days left in red when close", () => {
    expect(closingStamp("2026-11-12")).toEqual({ top: "Closes", main: "12 Nov", bottom: "in 3 days", urgent: true });
    expect(closingStamp("2027-01-15")).toEqual({ top: "Closes", main: "15 Jan", bottom: "2027", urgent: false });
    expect(closingStamp("2026-12-20", "lg")).toEqual({ top: "Closes", main: "20 Dec", bottom: "2026", urgent: false });
    expect(closingStamp(null)).toBeNull();
  });
});

describe("employer menu without counts", () => {
  it("lists only the types that always have vacancies (never EU institutions or development banks)", () => {
    expect(UNCHECKED_EMPLOYER_NAV.map((n) => n.href)).toEqual(["/un-jobs", "/ngo-jobs", "/international-organization-jobs"]);
  });
});
