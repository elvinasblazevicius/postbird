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
    ["Education Officer, (NO-), TA ( days), #, Chilpancingo, Guerrero – México, LACR", "Education Officer, Chilpancingo, Guerrero – México"],
    ["Education Officer, (NO-1), TA (364 days), #00138514, Chilpancingo, Guerrero – México, LACR", "Education Officer, (NO-1), Chilpancingo, Guerrero – México"],
    ["Deputy Representative Operations, (P-4) Fixed Term – Bangkok CSC, Thailand#13919", "Deputy Representative Operations, (P-4) Fixed Term – Bangkok CSC, Thailand"],
    ["Advisor, Partnerships – GL D – Defined Duration until December 2029", "Advisor, Partnerships"],
    ["Junior Electrical Systems Asset Manager (EN-EL-MO---GRAE)", "Junior Electrical Systems Asset Manager"],
    ["Human Rights Officer (TJO)", "Human Rights Officer"],
    ["Monitoring & Evaluation Officer, NO-, Temporary Position, days, Sarajevo, #", "Monitoring & Evaluation Officer, Temporary Position, Sarajevo"],
    ["Driver (G-), TA, #, Lashkar Gah, # and # Kandahar", "Driver, TA, Lashkar Gah, and Kandahar"],
    ["Senior Officer, P4 Programme", "Senior Officer, P4 Programme"],
    ["Paho Consultant – Comunicación Institucional y apoyo a Alianzas para el", "PAHO Consultant – Comunicación Institucional y apoyo a Alianzas"],
    ["DRIVER, IITA RWANDA", "Driver, IITA Rwanda"],
    ["Research Team Lead – Iita Kenya", "Research Team Lead – IITA Kenya"],
    ["International Health Consultant (remote with travel for . months)", "International Health Consultant (remote with travel for months)"],
    ["Impact Evaluation Officer", "Impact Evaluation Officer"],
    ["Meal Allowance Clerk", "Meal Allowance Clerk"],
    ["Oficial de Proyecto WASHNFI Base de Caracas", "Oficial de Proyecto WASH/NFI Base de Caracas"],
    ["Oficial Técnicoa", "Oficial Técnico/a"],
    ["National consultant – First Foods Action Plan, Freetown,remote with travel 596955", "National consultant – First Foods Action Plan, Freetown, remote with travel"],
    ["Women UN Women: Global Security Specialist", "UN Women: Global Security Specialist"],
    ["Roster of Consultants – ATACH, Seoul, Seoul", "Roster of Consultants – ATACH, Seoul"],
  ])("%s", (raw, clean) => expect(cleanTitle(raw)).toBe(clean));
});

describe("stripOrgFromTitle keeps hyphenated names", () => {
  it("keeps UN-Habitat when the employer is filed as UN", async () => {
    const { stripOrgFromTitle } = await import("@/lib/feeds/title");
    expect(stripOrgFromTitle("UN-Habitat Intern – Data analytics", ["United Nations Secretariat", "UN"])).toBe("UN-Habitat Intern – Data analytics");
    expect(stripOrgFromTitle("UN - Data Analyst", ["UN"])).toBe("Data Analyst");
  });
});

describe("cleanTitle keeps unit acronyms", () => {
  it("does not title-case EMOPS PCHP", () => {
    const t = "Interagency Consultant, UNICEF Office of Emergency Programmes, EMOPS PCHP, Geneva, Switzerland, 7 months (remote)";
    expect(cleanTitle(t)).toContain("EMOPS PCHP, Geneva");
    expect(cleanTitle("Officer – ACCOUNTS CLERK LOCAL AGENT")).toContain("Accounts Clerk");
  });
});
