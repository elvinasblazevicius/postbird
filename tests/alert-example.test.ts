import { describe, expect, it } from "vitest";
import { looksGarbled, moreLabel } from "@/components/alert-example";

describe("alert example", () => {
  it("leaves out titles with empty placeholders", () => {
    expect(looksGarbled("Education Officer, (NO-), TA ( days), #")).toBe(true);
    expect(looksGarbled("Programme Officer ()")).toBe(true);
    expect(looksGarbled("Finance Associate, , Nairobi")).toBe(true);
    expect(looksGarbled("Programme Officer (Education), P-3")).toBe(false);
    expect(looksGarbled("Consultant #2 for WASH")).toBe(false);
  });
  it("writes the remainder without a doubled plus", () => {
    expect(moreLabel(12)).toBe("+12 more");
    expect(moreLabel(1500)).toBe("999+ more");
  });
});
