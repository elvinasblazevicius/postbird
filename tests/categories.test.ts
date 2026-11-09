import { describe, expect, it } from "vitest";
import { ALL_CATEGORIES, CATEGORIES } from "@/config/categories";
import { detectCategory } from "@/lib/feeds/extract";
import { categoriesForWord } from "@/lib/search-intent";

describe("job categories", () => {
  it("has the new categories, each with a unique slug", () => {
    const slugs = ALL_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of ["education", "wash", "protection-humanitarian-affairs", "environment-climate-energy", "engineering-infrastructure", "security", "food-security-agriculture", "gender"]) {
      expect(slugs, s).toContain(s);
    }
  });

  it("names categories in sentence case", () => {
    for (const c of CATEGORIES) expect(c.name, c.slug).toMatch(/^(IT|[A-Z][a-z]+(?:[ ,]+[a-z]+)*)$/);
  });

  it("places titles in the new categories", () => {
    const cases: [string, string][] = [
      ["Education Specialist (Early Childhood)", "education"],
      ["Teacher Trainer", "education"],
      ["WASH Officer", "wash"],
      ["Water and Sanitation Engineer", "wash"],
      ["Child Protection Officer", "protection-humanitarian-affairs"],
      ["GBV Case Worker", "protection-humanitarian-affairs"],
      ["Humanitarian Affairs Officer", "protection-humanitarian-affairs"],
      ["Resettlement Assistant", "protection-humanitarian-affairs"],
      ["Climate Change Adaptation Specialist", "environment-climate-energy"],
      ["Renewable Energy Consultant", "environment-climate-energy"],
      ["Civil Engineer", "engineering-infrastructure"],
      ["Construction Site Supervisor", "engineering-infrastructure"],
      ["Field Security Officer", "security"],
      ["Security Associate", "security"],
      ["Food Security Analyst", "food-security-agriculture"],
      ["Agronomist", "food-security-agriculture"],
      ["Livelihoods Coordinator", "food-security-agriculture"],
      ["Gender Equality Specialist", "gender"],
      ["Programme Specialist, Women's Economic Empowerment", "gender"],
      ["Coordinador de Educación", "education"],
      ["Chargé de sécurité alimentaire", "food-security-agriculture"],
    ];
    for (const [title, slug] of cases) expect(detectCategory(title), title).toBe(slug);
  });

  it("keeps earlier categories first where titles overlap", () => {
    expect(detectCategory("Information Security Specialist")).toBe("it");
    expect(detectCategory("Software Engineer")).toBe("it");
    expect(detectCategory("Nutrition Officer")).toBe("health");
    expect(detectCategory("Programme Analyst")).toBe("programme-management");
    expect(detectCategory("Transport Assistant")).toBe("procurement-logistics");
  });

  it("puts fewer common titles in Other", () => {
    for (const t of ["Office Assistant", "Grants Officer", "Fundraising Manager", "Human Rights Officer", "Political Affairs Officer", "Head of Mission"]) {
      expect(detectCategory(t), t).not.toBe("other");
    }
  });

  it("matches the new category names in search words", () => {
    expect(categoriesForWord("water")).toEqual(["wash"]);
    expect(categoriesForWord("climate")).toEqual(["environment-climate-energy"]);
    expect(categoriesForWord("and")).toEqual([]);
    expect(categoriesForWord("security").sort()).toEqual(["food-security-agriculture", "security"]);
  });
});
