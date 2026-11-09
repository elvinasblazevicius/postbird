import { describe, expect, it } from "vitest";
import { countriesInLocation, locationPatterns, normalizePlace } from "@/lib/country-match";
import { gradeGroupOf, gradeMatches, isLocalOnlyGrade, LOCAL_ONLY_GRADE_SQL } from "@/lib/grades";
import { jobsUrl, parseFilters, wantsLooseMatch, withSearchIntent } from "@/lib/jobs";
import { alertStepKeep, searchFromAlertStep } from "@/lib/saved-searches";
import { categoriesForWord, interpretQuery } from "@/lib/search-intent";

describe("interpretQuery", () => {
  it("reads organization type, contract type and country, and keeps the rest as text", () => {
    expect(interpretQuery("un internship kenya")).toEqual({ text: null, orgtype: "un", type: "Internship", country: "kenya" });
    expect(interpretQuery("data analyst jobs in Kenya")).toEqual({ text: "data analyst", country: "kenya" });
  });

  it("recognises capitalised country acronyms but not other short aliases", () => {
    expect(interpretQuery("jobs in uae").country).toBe("united-arab-emirates");
    expect(interpretQuery("UK policy").country).toBe("united-kingdom");
    expect(interpretQuery("drc health")).toEqual({ text: "health", country: "democratic-republic-of-the-congo" });
    // "oPt" is an alias of Palestine but also an ordinary word.
    expect(interpretQuery("opt out").country).toBeUndefined();
  });

  it("reads remote phrases and fellowships", () => {
    expect(interpretQuery("work from home data")).toEqual({ text: "data", remote: true });
    expect(interpretQuery("home based consultant")).toEqual({ text: null, remote: true, type: "Consultancy" });
    expect(interpretQuery("research fellowship").type).toBe("Fellowship");
    expect(interpretQuery("internship consultancy").type).toBe("Internship");
  });

  it("reads grades as the grade filter and takes them out of the keywords", () => {
    expect(interpretQuery("P3 data")).toEqual({ text: "data", grade: "P-3" });
    expect(interpretQuery("programme officer p-4")).toEqual({ text: "programme officer", grade: "P-4" });
    expect(interpretQuery("D1")).toEqual({ text: null, grade: "D-1" });
    expect(interpretQuery("g5 assistant").grade).toBe("G-5");
    expect(interpretQuery("GS-6 finance").grade).toBe("GS-6");
    expect(interpretQuery("gs6").grade).toBe("GS-6");
    expect(interpretQuery("NOA health")).toEqual({ text: "health", grade: "NO-A" });
    expect(interpretQuery("no-b").grade).toBe("NO-B");
    expect(interpretQuery("FS-5 logistics").grade).toBe("FS-5");
    expect(interpretQuery("un p2 kenya")).toEqual({ text: null, orgtype: "un", grade: "P-2", country: "kenya" });
  });

  it("only reads whole words that are real grades", () => {
    for (const q of ["p38 protein", "dp3", "d3", "p8", "nof", "gs-9", "no", "g5 sahel liaison", "mp3", "p3x"]) {
      expect(interpretQuery(q).grade, q).toBeUndefined();
    }
    expect(interpretQuery("no objection").text).toBe("no objection");
  });

  it("turns a grade in the words into the grade filter, unless one is set (withSearchIntent)", () => {
    expect(withSearchIntent({ q: "p3 data" })).toMatchObject({ q: "data", grade: "P-3" });
    expect(withSearchIntent({ q: "p3 data", grade: "D" })).toMatchObject({ q: "data", grade: "D" });
    // Every grade the search reads is one parseFilters accepts, so the chip's links keep it.
    for (const q of ["p3", "d2", "noe", "g7", "gs1", "fs-7"]) {
      const grade = interpretQuery(q).grade!;
      expect(parseFilters({ grade }).grade, q).toBe(grade);
    }
  });

  it("leaves explicit filters alone (withSearchIntent)", () => {
    const f = withSearchIntent({ q: "kenya internship", country: "uganda", type: "Consultancy" });
    expect(f).toMatchObject({ q: undefined, country: "uganda", type: "Consultancy" });
    expect(withSearchIntent({ q: "kenya", region: "africa" }).country).toBeUndefined();
  });
});

describe("categoriesForWord", () => {
  it("matches category names as words, longer words also as a prefix", () => {
    expect(categoriesForWord("health")).toEqual(["health"]);
    expect(categoriesForWord("Data")).toEqual(["data-analytics"]);
    expect(categoriesForWord("procure")).toEqual(["procurement-logistics"]);
    expect(categoriesForWord("it")).toEqual(["it"]);
    expect(categoriesForWord("dat")).toEqual([]);
    expect(categoriesForWord("other")).toEqual([]);
    expect(categoriesForWord("c++")).toEqual([]);
  });
});

describe("local-only grades", () => {
  it("covers National Officer, General Service, NPSA, LICA and service contracts", () => {
    for (const g of ["NO-A", "NO-E", "NOB", "NO C", "G-5", "GS-4", "G7", "NPSA-8", "LICA-5", "SB-3", "SC-7"]) expect(isLocalOnlyGrade(g), g).toBe(true);
  });

  it("does not cover international grades or missing ones", () => {
    for (const g of ["P-3", "P-1", "D-1", "ASG", "FS-5", "IPSA-10", "ICS-9", "NO-F", "", null, undefined]) expect(isLocalOnlyGrade(g), String(g)).toBe(false);
  });

  it("uses the same rule in SQL as in JavaScript for stored grades", () => {
    const re = new RegExp(LOCAL_ONLY_GRADE_SQL);
    for (const g of ["NO-A", "NO-E", "G-1", "GS-7", "NPSA-11", "LICA-4", "SB-2", "SC-10", "P-3", "D-2", "FS-6", "IPSA-9", "ICS-11", "USG"]) {
      expect(re.test(g), g).toBe(isLocalOnlyGrade(g));
    }
  });

  it("is a filter in the URL", () => {
    expect(parseFilters({ hidelocal: "1" }).hidelocal).toBe(true);
    expect(parseFilters({ hidelocal: "yes" }).hidelocal).toBeUndefined();
    expect(jobsUrl({ hidelocal: true, country: "kenya" })).toBe("/jobs?country=kenya&hidelocal=1");
  });
});

describe("grade filter values", () => {
  it("places each exact grade in one group", () => {
    expect(gradeGroupOf("P-3")).toBe("P");
    expect(gradeGroupOf("NO-B")).toBe("NO");
    expect(gradeGroupOf("GS-5")).toBe("G");
    expect(gradeGroupOf("USG")).toBe("D");
    expect(gradeGroupOf("NPSA-7")).toBe("SC");
    expect(gradeGroupOf("P-6")).toBeNull();
  });

  it("matches a group or a single grade, never mixing the two", () => {
    expect(gradeMatches("P", "P-3")).toBe(true);
    expect(gradeMatches("P-3", "P-3")).toBe(true);
    expect(gradeMatches("P-3", "P-4")).toBe(false);
    expect(gradeMatches("NO", "P-2")).toBe(false);
    expect(gradeMatches("SC", "LICA-3")).toBe(true);
  });

  it("accepts groups and single grades in the URL, including SC grades", () => {
    expect(parseFilters({ grade: "P" }).grade).toBe("P");
    expect(parseFilters({ grade: "P-3" }).grade).toBe("P-3");
    expect(parseFilters({ grade: "SC-5" }).grade).toBe("SC-5");
    expect(parseFilters({ grade: "X-9" }).grade).toBeUndefined();
  });
});

describe("countries named in a location", () => {
  it("finds every country a listing names", () => {
    expect(countriesInLocation("Nairobi, Kenya; Kampala, Uganda").sort()).toEqual(["KE", "UG"]);
    expect(countriesInLocation("Abidjan, Côte d’Ivoire")).toEqual(["CI"]);
    expect(countriesInLocation("Kinshasa, DRC")).toEqual(["CD"]);
    expect(countriesInLocation(null)).toEqual([]);
  });

  it("prefers the longer name and ignores place names that only contain a country name", () => {
    expect(countriesInLocation("Juba, South Sudan")).toEqual(["SS"]);
    expect(countriesInLocation("Port Moresby, Papua New Guinea")).toEqual(["PG"]);
    expect(countriesInLocation("Bissau, Guinea-Bissau")).toEqual(["GW"]);
    expect(countriesInLocation("Newark, New Jersey")).toEqual([]);
    expect(countriesInLocation("Khartoum, Sudan or Juba, South Sudan").sort()).toEqual(["SD", "SS"]);
  });

  it("gives the same answer as the SQL patterns", () => {
    const texts = [
      "Nairobi, Kenya; Kampala, Uganda", "Juba, South Sudan", "Khartoum, Sudan", "Port Moresby, Papua New Guinea", "Conakry, Guinea",
      "Malabo, Equatorial Guinea", "Kinshasa, Democratic Republic of the Congo", "Brazzaville, Congo", "Seoul, Republic of Korea",
      "Pyongyang, DPRK", "Newark, New Jersey", "Abidjan, Côte d'Ivoire", "Geneva, Switzerland", "Home-based", "Niamey, Niger", "Abuja, Nigeria",
    ];
    for (const code of ["KE", "UG", "SD", "SS", "GN", "GQ", "PG", "CD", "CG", "KR", "KP", "JE", "CI", "CH", "NE", "NG"]) {
      const p = locationPatterns([code])!;
      for (const t of texts) {
        const sqlLike = new RegExp(p.match).test(normalizePlace(t).replace(new RegExp(p.strip, "g"), " "));
        expect(sqlLike, `${code} in "${t}"`).toBe(countriesInLocation(t).includes(code));
      }
    }
  });
});

describe("any-word fallback", () => {
  it("is tried only for a search of several words that found nothing", () => {
    expect(wantsLooseMatch("data zzzz", 0)).toBe(true);
    expect(wantsLooseMatch("data zzzz", 3)).toBe(false);
    expect(wantsLooseMatch("zzzz", 0)).toBe(false);
    expect(wantsLooseMatch(undefined, 0)).toBe(false);
  });
});

describe("alert sign-up step", () => {
  it("turns the step's answers into a saved search", () => {
    expect(searchFromAlertStep({ step: "watch", q: " data analyst ", org: "unicef", where: "region-africa" })).toBe("q=data+analyst&org=unicef&region=africa");
    expect(searchFromAlertStep({ step: "watch", q: "", org: "", where: "" })).toBeNull();
    expect(searchFromAlertStep({ step: "watch", q: "wash", where: "kenya", category: "health", remind: "12" })).toBe("q=wash&country=kenya&category=health");
  });

  it("falls back to ?search= and rejects what isn't a search", () => {
    expect(searchFromAlertStep({ search: "category=health" })).toBe("category=health");
    expect(searchFromAlertStep({ search: "<script>" })).toBeNull();
    expect(searchFromAlertStep({})).toBeNull();
  });

  it("carries the filters the step doesn't show", () => {
    expect(alertStepKeep("q=data&category=health&grade=P&country=kenya")).toEqual({ category: "health", grade: "P" });
    expect(alertStepKeep(null)).toEqual({});
  });
});
