import { describe, expect, it } from "vitest";
import siteConfig from "@site-config";
import { displayGrade, isLocalOnly, isLocalOnlyTitle, LOCAL_ONLY_TITLE_SQL, NATIONAL_OFFICER_TITLE_SQL } from "@/lib/grades";
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
    expect(displayGrade({ grade: null, title: "National Professional Officer (Education)" })).toBe("NO");
    expect(displayGrade({ grade: null, title: "NPO - WASH" })).toBe("NO");
    expect(displayGrade({ grade: "NO-C", title: "National Professional Officer" })).toBe("NO-C");
    expect(displayGrade({ grade: null, title: "International Officer" })).toBeNull();
    const re = sqlToJs(NATIONAL_OFFICER_TITLE_SQL);
    expect(re.test("national professional officer (education)")).toBe(true);
    expect(re.test("international officer")).toBe(false);
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
    expect(quarterly.text).toContain(`After your trial you're charged ${q.price} every ${q.per}, renewing automatically until you cancel. Cancel any time from your account page.`);
    expect(quarterly.text).toMatch(/Refund policy: https?:\/\/\S+\/refunds/);
    expect(quarterly.html).toContain("/refunds");
    const monthly = welcomeEmail({ accountUrl: "https://x/a", unsubscribeUrl: "https://x/u", trialEndsAt: "2026-11-23T10:00:00Z", plan: planDescription("month") });
    expect(monthly.text).toContain(`charged ${m.price} every month`);
    const unknown = welcomeEmail({ accountUrl: "https://x/a", unsubscribeUrl: "https://x/u", trialEndsAt: null, plan: siteConfig.premium.name });
    expect(unknown.text).toContain(`${m.price} every month or ${q.price} every 3 months`);
  });
});
