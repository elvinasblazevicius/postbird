import { describe, expect, it } from "vitest";
import { checkFacts, type AiFacts } from "@/lib/feeds/ai-extract";

const empty = { value: null, quote: null };
const facts = (over: Partial<AiFacts>): AiFacts => ({ closingDate: empty, country: empty, city: empty, organization: empty, contractType: empty, grade: empty, ...over });
const PAGE = "Programme Officer. Duty Station: Nairobi, Kenya. Grade: P-3. Type of contract: Fixed-term. Deadline for applications: 30 November 2026. UNICEF";
const today = new Date("2026-11-12T00:00:00Z");

describe("AI fill-in checks", () => {
  it("keeps values whose quote is on the page and that pass the checks", () => {
    const c = checkFacts(facts({
      closingDate: { value: "2026-11-30", quote: "Deadline for applications: 30 November 2026" },
      country: { value: "Kenya", quote: "Nairobi, Kenya" },
      grade: { value: "P-3", quote: "Grade: P-3" },
      contractType: { value: "Fixed-term", quote: "Type of contract: Fixed-term" },
    }), PAGE, today);
    expect(c).toMatchObject({ deadline: "2026-11-30", countryCode: "KE", grade: "P-3", contractType: "Fixed-term", rejected: [] });
  });

  it("rejects a value whose quote isn't on the page (an invented answer)", () => {
    const c = checkFacts(facts({ closingDate: { value: "2026-12-15", quote: "Closes 15 December 2026" } }), PAGE, today);
    expect(c.deadline).toBeNull();
    expect(c.rejected[0]).toMatch(/quote not on the page/);
  });

  it("rejects an implausible date, an unknown country and a made-up contract type", () => {
    const c = checkFacts(facts({
      closingDate: { value: "2031-01-01", quote: "Deadline for applications" },
      country: { value: "Atlantis", quote: "Duty Station" },
      contractType: { value: "Permanent", quote: "Type of contract" },
    }), PAGE, today);
    expect(c).toMatchObject({ deadline: null, countryCode: null, contractType: null });
    expect(c.rejected).toHaveLength(3);
  });

  it("keeps a city only when it is a place name in the text", () => {
    const ok = checkFacts(facts({ country: { value: "Kenya", quote: "Nairobi, Kenya" }, city: { value: "Nairobi", quote: "Duty Station: Nairobi" } }), PAGE, today);
    expect(ok).toMatchObject({ countryCode: "KE", city: "Nairobi" });
    const bad = checkFacts(facts({ city: { value: "Kenya", quote: "Nairobi, Kenya" } }), PAGE, today);
    expect(bad.city).toBeNull();
    const missing = checkFacts(facts({ city: { value: "Mombasa", quote: "Duty Station: Mombasa" } }), PAGE, today);
    expect(missing.city).toBeNull();
  });
});
