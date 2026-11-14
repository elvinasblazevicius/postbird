import { describe, expect, it } from "vitest";
import { cleanTitle } from "@/lib/feeds/title";

describe("cleanTitle: codes and sentences", () => {
  it.each([
    ["ICMPD VA26P197V01 Project Manager", "ICMPD Project Manager"],
    ["SVN2026041_Senior Project Associate (CCCM)", "Senior Project Associate (CCCM)"],
    ["VN-EC017--M&E Monitoring and evaluation assistant", "Monitoring and evaluation assistant"],
    ["CIMMYT K26373 Field Research Coordinator", "CIMMYT Field Research Coordinator"],
    ["Prosper Global is looking for Chief of Party, Programs, Nigeria.", "Chief of Party, Programs, Nigeria"],
    ["UNDP Chief Technical Advisor", "UNDP Chief Technical Advisor"],
    ["Senior Officer, P4 Programme", "Senior Officer, P4 Programme"],
  ])("%s", (raw, clean) => expect(cleanTitle(raw)).toBe(clean));
});
