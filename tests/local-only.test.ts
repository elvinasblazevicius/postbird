import { describe, expect, it } from "vitest";
import { saysNationalsOnly } from "@/lib/local-only";
import { isLocalOnly, localOnlyLabel } from "@/lib/grades";

describe("posts open only to nationals", () => {
  it("reads national consultant titles and wording", () => {
    expect(isLocalOnly({ grade: null, title: "National Communication Consultant, Branding and Advocacy Facilitator, Windhoek, Namibia" })).toBe(true);
    expect(localOnlyLabel({ grade: null, title: "National Communication Consultant" }, "Namibia")).toBe("Nationals of Namibia only");
    expect(saysNationalsOnly("This is a national consultancy based in Windhoek.", "NA")).toBe(true);
    expect(saysNationalsOnly("This is a locally recruited position.", "KE")).toBe(true);
  });

  it("reads statements naming the duty-station country", () => {
    expect(saysNationalsOnly("Only Namibian nationals are eligible to apply.", "NA")).toBe(true);
    expect(saysNationalsOnly("The vacancy is open to nationals of Kenya only.", "KE")).toBe(true);
    expect(saysNationalsOnly("Applicants must be a citizen of Kenya.", "KE")).toBe(true);
    expect(saysNationalsOnly("The position is open to Kenyan nationals.", "KE")).toBe(true);
  });

  it("ignores statements about other groups", () => {
    expect(saysNationalsOnly("Only EU citizens may apply.", "BE")).toBe(false);
    expect(saysNationalsOnly("Open to nationals of OECD member countries only.", "FR")).toBe(false);
    expect(saysNationalsOnly("Nationals of non-represented countries are encouraged to apply.", "US")).toBe(false);
    expect(saysNationalsOnly("Only Kenyan nationals may apply.", "UG")).toBe(false);
    expect(saysNationalsOnly("International consultant to support the national strategy.", "NA")).toBe(false);
    expect(isLocalOnly({ grade: null, title: "International Consultant – National Health Strategy" })).toBe(false);
  });

  it("uses the stored answer", () => {
    expect(isLocalOnly({ grade: "P-3", title: "Programme Officer", local_only: true })).toBe(true);
    expect(localOnlyLabel({ grade: null, title: "Programme Officer", local_only: true }, "Kenya")).toBe("Nationals of Kenya only");
  });
});
