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

describe("shareWords", () => {
  it("says a share in plain words", async () => {
    const { shareWords } = await import("@/lib/jobs");
    expect(shareWords(921, 202)).toBe("About 1 in 5");
    expect(shareWords(165, 54)).toBe("About 1 in 3");
    expect(shareWords(50, 20)).toBeNull();
    expect(shareWords(500, 30)).toBeNull();
  });
});

describe("language requirements written in French, Spanish and Portuguese", () => {
  it("reads required and desirable languages in French", async () => {
    const { detectLanguageRequirements } = await import("@/lib/feeds/extract");
    const r = detectLanguageRequirements("Exigences linguistiques : Excellente maîtrise du français, à l’écrit comme à l’oral. Bonne maîtrise de l’arabe. La maîtrise de l’espagnol est un atout.");
    expect(r.required).toEqual(["Arabic", "French"]);
    expect(r.desirable).toEqual(["Spanish"]);
  });
  it("reads Spanish and Portuguese wording", async () => {
    const { detectLanguageRequirements } = await import("@/lib/feeds/extract");
    expect(detectLanguageRequirements("Idiomas: dominio del español requerido; el conocimiento del francés es deseable.").required).toEqual(["Spanish"]);
    expect(detectLanguageRequirements("Requisitos de idioma: fluência em português é obrigatória. Conhecimento de francês é desejável.").required).toEqual(["Portuguese"]);
  });
  it("still ignores languages that aren't about the job", async () => {
    const { detectLanguageRequirements } = await import("@/lib/feeds/extract");
    expect(detectLanguageRequirements("Le bureau couvre les pays francophones de la région.").required).toBeNull();
  });
});

describe("title language with an English unit name", () => {
  it("knows a French title that names an English section", async () => {
    const { titleLanguage } = await import("@/lib/title-language");
    expect(titleLanguage("Consultant·e en suivi et coordination en santé et nutrition, UNICEF Morocco, Health&Nutrition section, basé·e dans la région de Béni Mella, à domicile, 1 an – Morocco, Marrakech")?.name).toBe("French");
    expect(titleLanguage("Health and Nutrition Officer, programme de santé")).toBeNull();
  });
});

describe("a category label repeating the title", () => {
  it("drops the label", () => {
    expect(cleanTitle("Consultant: Consultant on Regional Environmental Assessment, Monitoring and Data Analysis")).toBe("Consultant on Regional Environmental Assessment, Monitoring and Data Analysis");
    expect(cleanTitle("Internship: Internship in Communications")).toBe("Internship in Communications");
    expect(cleanTitle("Consultant: Data Analysis")).toBe("Consultant: Data Analysis");
  });
});
