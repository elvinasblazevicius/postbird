import { describe, expect, it } from "vitest";
import siteConfig from "@site-config";
import { displayGrade, GENERAL_SERVICE_TITLE_SQL, gradeGroupOf, isLocalOnly, isLocalOnlyTitle, LOCAL_ONLY_TITLE_SQL, NATIONAL_OFFICER_TITLE_SQL, PROFESSIONAL_TITLE_SQL, titleGradeGroup } from "@/lib/grades";
import { planDescription, trialLine, RENEWS } from "@/lib/early-access-copy";
import { welcomeEmail } from "@/lib/email-templates";
import { searchFromSignupForm } from "@/lib/saved-searches";
import { foldText, interpretQuery, orgNamesForTerm, searchTerms } from "@/lib/search-intent";
import { formatShortDate } from "@/lib/site";
import { titleLanguage } from "@/lib/title-language";

/** Postgres advanced regex → JavaScript, for the word boundaries the SQL patterns use. */
const sqlToJs = (re: string) => new RegExp(re.replaceAll("\\m", "(?<![a-z0-9])").replaceAll("\\M", "(?![a-z0-9])"));

describe("local-only posts from the title", () => {
  const local = [
    "National Officer - Health", "National Professional Officer (Nutrition)", "NPO, Immunization", "National Consultant for M&E",
    "National Individual Consultant - Gender", "National UN Volunteer - Programme", "Driver (locally recruited)", "Programme Assistant, G-5",
    "Finance Associate GS-6", "Senior Clerk (GS5)", "Programme Officer NO-B", "Senior Driver (G)",
  ];
  const international = [
    "International Consultant", "Programme Officer (P)", "Health Officer (P-3)", "International Officer", "G5 Sahel Liaison Officer",
    "Nonprofit Partnerships Lead", "No-cost Extension Analyst", "Logistics Officer",
  ];

  it("recognises national and locally recruited posts", () => {
    for (const t of local) expect(isLocalOnlyTitle(t), t).toBe(true);
    for (const t of international) expect(isLocalOnlyTitle(t), t).toBe(false);
  });

  it("uses the same rule in SQL as in JavaScript", () => {
    const re = sqlToJs(LOCAL_ONLY_TITLE_SQL);
    for (const t of [...local, ...international]) expect(re.test(t.toLowerCase()), t).toBe(isLocalOnlyTitle(t));
  });

  it("combines the grade and the title", () => {
    expect(isLocalOnly({ grade: "NO-B", title: "Health Officer" })).toBe(true);
    expect(isLocalOnly({ grade: null, title: "National Health Officer" })).toBe(false);
    expect(isLocalOnly({ grade: null, title: "National Professional Officer - Health" })).toBe(true);
    expect(isLocalOnly({ grade: "P-3", title: "Programme Officer" })).toBe(false);
  });

  it("infers grade NO from a National (Professional) Officer title when no grade was parsed", () => {
    expect(displayGrade({ grade: null, title: "National Professional Officer (Education)" })).toBe("National Officer");
    expect(displayGrade({ grade: null, title: "NPO - WASH" })).toBe("National Officer");
    expect(displayGrade({ grade: null, title: "International Officer" })).toBeNull();
    const re = sqlToJs(NATIONAL_OFFICER_TITLE_SQL);
    expect(re.test("national professional officer (education)")).toBe(true);
    expect(re.test("international officer")).toBe(false);
  });
});

describe("IOM's (P) and (G) title suffixes", () => {
  it("give the grade group when no grade was parsed", () => {
    expect(titleGradeGroup("Programme Officer (P)")).toBe("P");
    expect(titleGradeGroup("Senior Driver (G)")).toBe("G");
    expect(titleGradeGroup("Project Assistant (G) - Nairobi")).toBe("G");
    expect(titleGradeGroup("Monitoring and Evaluation (M&E) Officer (P)")).toBe("P");
    expect(titleGradeGroup("National Professional Officer (P)")).toBe("NO"); // counted once, under National Officer
    expect(titleGradeGroup("Officer (Protection) - Kabul")).toBeNull();
    expect(titleGradeGroup("Data (P) Analyst")).toBeNull();
    expect(displayGrade({ grade: null, title: "Programme Officer (P)" })).toBe("Professional");
    expect(displayGrade({ grade: null, title: "Senior Driver (G)" })).toBe("General Service");
  });

  it("never replace a parsed grade, so a listing is counted once", () => {
    expect(displayGrade({ grade: "P-3", title: "Programme Officer (P)" })).toBe("P-3");
    expect(displayGrade({ grade: "G-5", title: "Senior Driver (G)" })).toBe("G-5");
  });

  it("use the same rule in SQL as in JavaScript", () => {
    const p = sqlToJs(PROFESSIONAL_TITLE_SQL);
    const g = sqlToJs(GENERAL_SERVICE_TITLE_SQL);
    for (const t of ["Programme Officer (P)", "Assistant (G) - Juba", "Officer (Protection)", "Driver (G)"]) {
      expect(p.test(t.toLowerCase()), t).toBe(titleGradeGroup(t) === "P");
      expect(g.test(t.toLowerCase()), t).toBe(titleGradeGroup(t) === "G");
    }
  });

  it("count under their group in the grade filter", () => {
    expect(gradeGroupOf("P")).toBe("P");
    expect(gradeGroupOf("G")).toBe("G");
    expect(gradeGroupOf("NO")).toBe("NO");
  });
});

describe("grade filter options", () => {
  it("count the whole group, including listings that give only the group", async () => {
    const { anyLevelLabel, gradeGroupCounts } = await import("@/components/search-forms");
    const facets = { grades: [{ grade: "NO", count: 4 }, { grade: "NO-B", count: 2 }, { grade: "NO-C", count: 0 }, { grade: "P-3", count: 5 }] };
    const no = gradeGroupCounts(facets, "NO", () => false);
    expect(no.count).toBe(6);
    expect(no.exact.map((x) => x.grade)).toEqual(["NO-B"]);
    expect(gradeGroupCounts(facets, "P", () => false).count).toBe(5);
    expect(anyLevelLabel("National Officer (NO-A to NO-E)")).toBe("National Officer, any level");
  });
});

describe("displayGrade", () => {
  it("writes National Officer grades out in full", () => {
    expect(displayGrade({ grade: "NO-C", title: "National Professional Officer" })).toBe("National Officer C");
    expect(displayGrade({ grade: "NO-A", title: "Programme Officer" })).toBe("National Officer A");
    expect(displayGrade({ grade: "NOB", title: "Programme Officer" })).toBe("National Officer B");
  });

  it("leaves other grades as stored", () => {
    expect(displayGrade({ grade: "P-3", title: "Programme Officer" })).toBe("P-3");
    expect(displayGrade({ grade: "G-5", title: "Programme Assistant" })).toBe("G-5");
    expect(displayGrade({ grade: "NPSA-8", title: "Field Associate" })).toBe("NPSA-8");
    expect(displayGrade({ grade: null, title: "Programme Officer" })).toBeNull();
  });
});

describe("accent-insensitive search terms", () => {
  it("folds accents the way pb_fold does", () => {
    expect(foldText("Médecins Sans Frontières")).toBe("medecins sans frontieres");
    expect(foldText("Côte d’Ivoire")).toBe("cote d’ivoire");
    expect(foldText("Œuvre ÉDUCATION Straße")).toBe("oeuvre education strasse");
  });

  it("knows organization aliases and short names", () => {
    expect(orgNamesForTerm("msf")).toContain("medecins sans frontieres");
    expect(orgNamesForTerm("MdM")).toContain("medecins du monde");
    expect(orgNamesForTerm("adb")).toContain("asian development bank");
    expect(orgNamesForTerm("AfDB")).toContain("african development bank");
    expect(orgNamesForTerm("eib")).toContain("european investment bank");
    expect(orgNamesForTerm("idb")).toContain("inter-american development bank");
    expect(orgNamesForTerm("iom")).toContain("international organization for migration");
    expect(orgNamesForTerm("unhcr")).toContain("united nations high commissioner for refugees");
    expect(orgNamesForTerm("doctors without borders")).toContain("medecins sans frontieres");
    expect(orgNamesForTerm("médecins du monde")).toContain("medecins du monde");
    expect(orgNamesForTerm("un")).toEqual([]);
    expect(orgNamesForTerm("nurse")).toEqual([]);
  });

  it("keeps organization names of several words together", () => {
    expect(searchTerms("doctors without borders nurse")).toEqual(["doctors without borders", "nurse"]);
    expect(interpretQuery("doctors of the world jobs in kenya")).toEqual({ text: "doctors of the world", country: "kenya" });
    // Organization-type words still pick the type, and a portal name is not taken for one agency.
    expect(interpretQuery("un careers")).toEqual({ text: null, orgtype: "un" });
  });
});

describe("title language", () => {
  it("tags titles that are clearly not in English", () => {
    expect(titleLanguage("Oficial de Proyectos")?.name).toBe("Spanish");
    expect(titleLanguage("Chargé(e) de suivi et évaluation")?.code).toBe("fr");
    expect(titleLanguage("Assistente de Projeto")?.code).toBe("pt");
    expect(titleLanguage("مسؤول برامج")?.code).toBe("ar");
  });

  it("leaves English and unclear titles alone", () => {
    for (const t of ["Programme Officer", "Data Officer", "Senior Programme Manager", "Oficial de Programa", "Consultant national", "Associate Expert"]) {
      expect(titleLanguage(t), t).toBeNull();
    }
  });
});

describe("alert sign-up form", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("turns the in-form fields into the saved search", () => {
    expect(searchFromSignupForm(form({ watch_q: " data analyst ", watch_org: "unicef", watch_where: "region-africa" }))).toBe("q=data+analyst&org=unicef&region=africa");
    expect(searchFromSignupForm(form({ watch_q: "", watch_org: "", watch_where: "" }))).toBe("");
  });

  it("keeps the other filters of a search started on the jobs page, with the fields in place of its words and place", () => {
    expect(searchFromSignupForm(form({ search: "q=data&category=health&country=kenya", watch_q: "nurse", watch_org: "", watch_where: "uganda" }))).toBe("q=nurse&country=uganda&category=health");
    expect(searchFromSignupForm(form({ search: "category=health" }))).toBe("category=health");
    expect(searchFromSignupForm(form({ search: "<script>" }))).toBe("");
  });
});

describe("dates and paid-alert copy", () => {
  it("shows the year in short dates only when it isn't this year", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    expect(formatShortDate("2026-12-01", now)).toBe("1 Dec");
    expect(formatShortDate("2027-01-15", now)).toBe("15 Jan 2027");
  });

  it("puts the renewal in the trial line", () => {
    expect(trialLine()).toContain(`Your plan ${RENEWS} until you cancel`);
  });

  it("spells out the charge and links the refund policy in the welcome email", () => {
    const [m, q] = siteConfig.premium.plans;
    const quarterly = welcomeEmail({ accountUrl: "https://x/a", unsubscribeUrl: "https://x/u", trialEndsAt: "2026-11-23T10:00:00Z", plan: planDescription("quarter") });
    expect(quarterly.text).toContain(`After your trial you're charged ${q.price} every ${q.per} (VAT or sales tax included or added, depending on where you live), renewing automatically until you cancel. Cancel any time from your account page.`);
    expect(quarterly.text).toMatch(/Refund policy: https?:\/\/\S+\/refunds/);
    expect(quarterly.html).toContain("/refunds");
    const monthly = welcomeEmail({ accountUrl: "https://x/a", unsubscribeUrl: "https://x/u", trialEndsAt: "2026-11-23T10:00:00Z", plan: planDescription("month") });
    expect(monthly.text).toContain(`charged ${m.price} every month`);
    const unknown = welcomeEmail({ accountUrl: "https://x/a", unsubscribeUrl: "https://x/u", trialEndsAt: null, plan: siteConfig.premium.name });
    expect(unknown.text).toContain(`${m.price} every month or ${q.price} every 3 months`);
  });
});

describe("organization names in sentences", () => {
  it("uses acronyms as they are and adds “the” to names that need it", async () => {
    const { orgInText, withArticle, nonAffiliationLine } = await import("@/lib/org-names");
    expect(orgInText("World Food Programme", "WFP")).toBe("WFP");
    expect(orgInText("UN Women", "UN Women")).toBe("UN Women");
    expect(orgInText("World Bank", "World Bank")).toBe("the World Bank");
    expect(orgInText("International Rescue Committee", null)).toBe("the International Rescue Committee");
    expect(orgInText("African Development Bank", "AfDB")).toBe("the African Development Bank");
    expect(withArticle("Save the Children")).toBe("Save the Children");
    expect(withArticle("Médecins Sans Frontières")).toBe("Médecins Sans Frontières");
    expect(nonAffiliationLine("Postbird", null)).toBe("Postbird is independent and not affiliated with these organizations.");
  });
});

describe("job page and card helpers", () => {
  it("shows the published location only when it adds something", async () => {
    const { extraLocation } = await import("@/lib/place-text");
    expect(extraLocation("Amman, Jordan", "Amman")).toBeNull();
    expect(extraLocation("Amman, Jordan", "Amman, Jordan")).toBeNull();
    expect(extraLocation("Juba, South Sudan", "Juba; Wau")).toBe("also Wau");
  });

  it("shows only the part of the published location that isn't shown already", async () => {
    const { extraLocation } = await import("@/lib/place-text");
    expect(extraLocation("Amman, Jordan", "Amman, Jordan with frequent travel to the region")).toBe("with frequent travel to the region");
    expect(extraLocation("Amman, Jordan", "Jordan with frequent travel to the region")).toBe("with frequent travel to the region");
    expect(extraLocation("Amman, Jordan", "Amman and Irbid")).toBe("also Irbid");
    expect(extraLocation("Kenya", "Nairobi or Mombasa, Kenya")).toBe("Nairobi or Mombasa");
    expect(extraLocation("Geneva, Switzerland", "Geneva, Switzerland (Home-based possible)")).toBe("Home-based possible");
    expect(extraLocation("Genève, Switzerland", "Geneve")).toBeNull();
    expect(extraLocation("Addis Ababa, Ethiopia", "Addis Ababa")).toBeNull();
  });

  it("keeps badge text on one line, smaller for longer monograms", async () => {
    const { badgeFontSize, badgeText } = await import("@/components/job-card");
    expect(badgeText("WFP")).toBe("WFP");
    expect(badgeText("UNICEF")).toBe("UNICEF");
    expect(badgeText("ABCDEFGHIJ")).toBe("ABCDE");
    expect(badgeFontSize("WFP", "sm")).toBe("text-[0.75rem]");
    expect(badgeFontSize("UNHCR", "sm")).toBe("text-[0.6rem]");
    expect(badgeFontSize("UNICEF", "sm")).toBe("text-[0.5625rem]");
    expect(badgeFontSize("A", "lg")).toBe("text-base");
  });

  it("never makes a monogram longer than 5 characters, except a known 6-letter acronym", async () => {
    const { monogram } = await import("@/lib/site");
    expect(monogram("UNICEF", "UNICEF")).toBe("UNICEF");
    expect(monogram("Some Long Name Alliance", "SLNAORG")).toBe("SLNA");
    expect(monogram("Helpers Network", "HELPNET")).toBe("HN");
    expect(monogram("Acmeorgs", null)).toBe("AC");
    expect(monogram("Example Org", "EXORG")).toBe("EXORG");
  });

  it("gives every organization a monogram, from the known-organizations list first", async () => {
    const { monogram } = await import("@/lib/site");
    expect(monogram("Médecins Sans Frontières", null)).toBe("MSF");
    expect(monogram("Medecins Sans Frontieres", null)).toBe("MSF");
    expect(monogram("Norwegian Refugee Council", null)).toBe("NRC");
    expect(monogram("World Food Programme", "WFP")).toBe("WFP");
    expect(monogram("World Bank Group", "World Bank")).toBe("WB");
    expect(monogram("Helpers International", null)).toBe("HI");
    expect(monogram("Agency for Technical Cooperation and Development", null)).toBe("ACTED");
  });

  it("marks new listings and shows the age of older ones", async () => {
    const { postedMarker } = await import("@/components/job-card");
    const now = Date.parse("2026-11-09T12:00:00Z");
    const at = (h: number) => ({ published_at: new Date(now - h * 3_600_000), first_seen_at: new Date(now) });
    expect(postedMarker(at(5), now)).toEqual({ text: "New", fresh: true });
    expect(postedMarker(at(47), now)?.text).toBe("New");
    expect(postedMarker(at(50), now)?.text).toBe("2d ago");
    expect(postedMarker(at(24 * 40), now)).toBeNull();
  });
});
