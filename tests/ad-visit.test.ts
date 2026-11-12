import { describe, expect, it } from "vitest";
import { isMetaVisit } from "@/lib/ad-visit";

describe("recognising a visit from a Meta ad", () => {
  it("accepts the campaign tag in any spelling, and Meta's click id", () => {
    for (const utm_source of ["meta", "Meta", " META ", "facebook", "Facebook", "fb", "ig", "Instagram"]) expect(isMetaVisit({ utm_source })).toBe(true);
    expect(isMetaVisit({ fbclid: "abc123" })).toBe(true);
    expect(isMetaVisit({ utm_source: ["meta", "google"] })).toBe(true);
  });

  it("leaves other visits alone", () => {
    expect(isMetaVisit({})).toBe(false);
    expect(isMetaVisit({ utm_source: "google" })).toBe(false);
    expect(isMetaVisit({ utm_source: "metafilter" })).toBe(false);
    expect(isMetaVisit({ fbclid: "" })).toBe(false);
  });
});
