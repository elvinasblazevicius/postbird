import { describe, expect, it } from "vitest";
import { countriesInLocation, locationPatterns, normalizePlace } from "@/lib/country-match";
import { gradeGroupOf, gradeMatches, isLocalOnlyGrade, LOCAL_ONLY_GRADE_SQL } from "@/lib/grades";
import { activeFilterCount, derivedFilters, filtersFromQuery, jobsUrl, parseFilters, wantsLooseMatch, withSearchIntent } from "@/lib/jobs";
import { alertStepKeep, describeSearch, normalizeSearch, searchFromAlertStep, searchFromSignupForm } from "@/lib/saved-searches";
import { categoriesForWord, interpretQuery, languageFromWord, placeVariants, SEARCH_REGION_SLUGS, searchTerms } from "@/lib/search-intent";
import { regionBySlug } from "@/config/regions";

describe("duty-station names", () => {
  it("finds other spellings and names of common duty stations, with or without accents", () => {
    expect(placeVariants("geneve")).toContain("geneva");
    expect(placeVariants("Genève")).toContain("geneva");
    expect(placeVariants("geneva")).toEqual(expect.arrayContaining(["geneve", "genf"]));
    expect(placeVariants("kiev")).toEqual(["kyiv"]);
    expect(placeVariants("Kyiv")).toEqual(["kiev"]);
    expect(placeVariants("bruxelles")).toContain("brussels");
    expect(placeVariants("wien")).toEqual(["vienna"]);
    expect(placeVariants("roma")).toEqual(["rome"]);
    expect(placeVariants("NY")).toEqual(expect.arrayContaining(["new york"]));
    expect(placeVariants("addis")).toContain("addis ababa");
    expect(placeVariants("hague")).toContain("den haag");
    expect(placeVariants("officer")).toEqual([]);
  });

  it("keeps place names of several words together as one search term", () => {
    expect(searchTerms("den haag legal")).toEqual(["den haag", "legal"]);
    expect(searchTerms("Addis Ababa finance")).toEqual(["addis ababa", "finance"]);
    expect(interpretQuery("finance officer Den Haag").text).toBe("den haag finance officer");
    expect(interpretQuery("jobs in the hague").text).toBe("hague");
    expect(interpretQuery("genève").text).toBe("genève");
  });
});

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
    expect(withSearchIntent({ q: "p3 data" })).toMatchObject({ q: "data", grade: ["P-3"] });
    expect(withSearchIntent({ q: "p3 data", grade: ["D"] })).toMatchObject({ q: "data", grade: ["D"] });
    // Every grade the search reads is one parseFilters accepts, so the chip's links keep it.
    for (const q of ["p3", "d2", "noe", "g7", "gs1", "fs-7"]) {
      const grade = interpretQuery(q).grade!;
      expect(parseFilters({ grade }).grade, q).toEqual([grade]);
    }
  });

  it("leaves explicit filters alone (withSearchIntent)", () => {
    const f = withSearchIntent({ q: "kenya internship", country: ["uganda"], type: ["Consultancy"] });
    expect(f).toMatchObject({ q: undefined, country: ["uganda"], type: ["Consultancy"] });
    expect(withSearchIntent({ q: "kenya", region: ["africa"] }).country).toBeUndefined();
    expect(withSearchIntent({ q: "kenya" }).country).toEqual(["kenya"]);
  });
});

describe("region words in a search", () => {
  it("picks the region filter for each region word, with the word taken out of the keywords", () => {
    const cases: [string, string][] = [
      ["africa", "africa"],
      ["Europe", "europe"],
      ["asia", "asia"],
      ["Asia and the Pacific", "asia-pacific"],
      ["pacific", "pacific"],
      ["latin america", "latin-america"],
      ["Latin America and the Caribbean", "latin-america-caribbean"],
      ["middle east", "middle-east"],
      ["MENA", "middle-east-north-africa"],
      ["north africa", "africa"],
      ["central asia", "central-asia"],
      ["Caribbean", "caribbean"],
    ];
    for (const [q, region] of cases) {
      expect(interpretQuery(`${q} jobs`), q).toEqual({ text: null, region });
      expect(regionBySlug(region), region).toBeDefined();
    }
    for (const slug of SEARCH_REGION_SLUGS) expect(regionBySlug(slug), slug).toBeDefined();
    expect(interpretQuery("health officer in Africa")).toEqual({ text: "health officer", region: "africa" });
    expect(interpretQuery("un internship latin america")).toEqual({ text: null, orgtype: "un", type: "Internship", region: "latin-america" });
  });

  it("leaves countries, organizations and other words alone", () => {
    // A country wins, and the region word next to it isn't left as a keyword.
    expect(interpretQuery("south africa")).toEqual({ text: null, country: "south-africa" });
    expect(interpretQuery("kenya africa")).toEqual({ text: null, country: "kenya" });
    expect(interpretQuery("Central African Republic").country).toBe("central-african-republic");
    expect(interpretQuery("Central African Republic").region).toBeUndefined();
    // Organization names and other words that only contain a region word.
    expect(interpretQuery("council of europe")).toEqual({ text: "council of europe" });
    expect(interpretQuery("african development bank").region).toBeUndefined();
    expect(interpretQuery("asian studies").region).toBeUndefined();
    expect(interpretQuery("european affairs").region).toBeUndefined();
  });

  it("becomes the region filter, unless a place is already chosen (withSearchIntent)", () => {
    expect(withSearchIntent({ q: "africa nutrition" })).toMatchObject({ q: "nutrition", region: ["africa"] });
    expect(withSearchIntent({ q: "africa nutrition", region: ["asia-pacific"] })).toMatchObject({ q: "nutrition", region: ["asia-pacific"] });
    expect(withSearchIntent({ q: "africa", country: ["kenya"] }).region).toBeUndefined();
    // parseFilters keeps the slug, so the chip's links keep it.
    expect(parseFilters({ region: "middle-east-north-africa" }).region).toEqual(["middle-east-north-africa"]);
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
    expect(jobsUrl({ hidelocal: true, country: ["kenya"] })).toBe("/jobs?country=kenya&hidelocal=1");
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
    expect(parseFilters({ grade: "P" }).grade).toEqual(["P"]);
    expect(parseFilters({ grade: "P-3" }).grade).toEqual(["P-3"]);
    expect(parseFilters({ grade: "SC-5" }).grade).toEqual(["SC-5"]);
    expect(parseFilters({ grade: "X-9" }).grade).toBeUndefined();
  });
});

describe("filters with several values", () => {
  it("reads repeated grade and where parameters, drops invalid ones and keeps a fixed order", () => {
    const f = parseFilters({ grade: ["P-4", "X-9", "P-3", "P-4"], where: ["uganda", "region-africa", "nowhere", "kenya"] });
    expect(f.grade).toEqual(["P-3", "P-4"]);
    expect(f.country).toEqual(["kenya", "uganda"]);
    expect(f.region).toEqual(["africa"]);
    expect(jobsUrl(f)).toBe("/jobs?country=kenya&country=uganda&region=africa&grade=P-3&grade=P-4");
    // The URL it builds reads back the same.
    expect(filtersFromQuery(jobsUrl(f).split("?")[1])).toEqual(f);
  });

  it("counts each value as a filter in use", () => {
    expect(activeFilterCount({ grade: ["P-3", "P-4"], country: ["kenya"], q: "data" })).toBe(4);
  });

  it("keeps every value in a saved search, in the same order whatever order they came in", () => {
    expect(normalizeSearch("grade=P-4&grade=P-3&where=uganda&where=kenya")).toBe("country=kenya&country=uganda&grade=P-3&grade=P-4");
    expect(normalizeSearch("where=kenya&grade=P-3&where=uganda&grade=P-4")).toBe("country=kenya&country=uganda&grade=P-3&grade=P-4");
    expect(normalizeSearch("https://example.org/jobs?grade=NO&grade=P&sort=deadline")).toBe("grade=NO&grade=P");
  });

  it("carries several places from the alert sign-up form, and several grades from its search", () => {
    const form = new FormData();
    form.set("search", "grade=P-3&grade=P-4&country=france");
    form.set("watch_q", "data");
    form.append("watch_where", "kenya");
    form.append("watch_where", "region-asia-pacific");
    form.append("watch_where", "");
    expect(searchFromSignupForm(form)).toBe("q=data&country=kenya&region=asia-pacific&grade=P-3&grade=P-4");
    expect(searchFromAlertStep({ step: "watch", where: ["kenya", "uganda"], grade: ["P-3", "P-2"] })).toBe("country=kenya&country=uganda&grade=P-2&grade=P-3");
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
  it("is tried for a search of several words that found nothing (one word that found nothing finds nothing)", () => {
    expect(wantsLooseMatch("data zzzz", 0)).toBe(true);
    expect(wantsLooseMatch("data zzzz", 3)).toBe(false);
    expect(wantsLooseMatch("finanse", 0)).toBe(false);
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
    expect(alertStepKeep("q=data&category=health&grade=P&country=kenya")).toEqual([["category", "health"], ["grade", "P"]]);
    expect(alertStepKeep("grade=P-3&grade=P-4")).toEqual([["grade", "P-3"], ["grade", "P-4"]]);
    expect(alertStepKeep(null)).toEqual([]);
  });
});

describe("describeSearch", () => {
  it("names every filter a saved search carries", async () => {
    expect(await describeSearch("q=data&category=data-analytics&country=kenya&country=uganda&grade=P-3&grade=P-4&type=Consultancy&exp=3-5&lang=French&orgtype=un&posted=7&closing=7&hidelocal=1&remote=1")).toBe(
      "“data”, Data and analytics jobs, in the UN system, in Kenya or Uganda, remote / home-based, grade P-3 or P-4, consultancy, experience 3–5 years, French mentioned, posted in the last 7 days, closing within 7 days, without local-only posts",
    );
  });

  it("names regions and grade groups, and says nothing for an empty search", async () => {
    expect(await describeSearch("region=africa&country=france&grade=P")).toBe("in Africa or France, grade Professional (P-1 to P-5)");
    expect(await describeSearch("orgtype=io&lang=Spanish")).toBe("at other international organizations, Spanish mentioned");
    expect(await describeSearch("")).toBeNull();
  });
});

describe("several organizations", () => {
  it("reads repeated org parameters, drops invalid ones and keeps a fixed order", () => {
    const f = parseFilters({ org: ["wfp", "unicef", "Bad Slug", "wfp"] });
    expect(f.org).toEqual(["unicef", "wfp"]);
    expect(jobsUrl(f)).toBe("/jobs?org=unicef&org=wfp");
    expect(filtersFromQuery(jobsUrl(f).split("?")[1])).toEqual(f);
    expect(parseFilters({ org: "iom" }).org).toEqual(["iom"]);
    expect(activeFilterCount({ org: ["unicef", "wfp"], q: "data" })).toBe(3);
  });

  it("keeps every organization in a saved search and in the alert sign-up", () => {
    expect(normalizeSearch("org=wfp&org=unicef&grade=P-3")).toBe("org=unicef&org=wfp&grade=P-3");
    expect(searchFromAlertStep({ step: "watch", org: ["wfp", "iom"], where: "" })).toBe("org=iom&org=wfp");
    const form = new FormData();
    form.set("search", "org=undp&category=health");
    form.append("watch_org", "wfp");
    form.append("watch_org", "unicef");
    form.append("watch_org", "");
    expect(searchFromSignupForm(form)).toBe("org=unicef&org=wfp&category=health");
  });
});

describe("listings that don't state a detail (unstated)", () => {
  it("is kept only while a filter read from the posting's text is in use", () => {
    expect(parseFilters({ grade: "P-3", unstated: "1" }).unstated).toBe(true);
    expect(parseFilters({ exp: "3-5", unstated: "1" }).unstated).toBe(true);
    expect(parseFilters({ lang: "French", unstated: "1" }).unstated).toBe(true);
    expect(parseFilters({ type: "Consultancy", unstated: "1" }).unstated).toBe(true);
    // Read from the search words ("p3", "french") counts too.
    expect(parseFilters({ q: "p3 data", unstated: "1" }).unstated).toBe(true);
    expect(parseFilters({ q: "french", unstated: "1" }).unstated).toBe(true);
    expect(parseFilters({ category: "health", unstated: "1" }).unstated).toBeUndefined();
    expect(parseFilters({ grade: "P-3", unstated: "yes" }).unstated).toBeUndefined();
  });

  it("is written into the URL and saved searches only with such a filter", () => {
    expect(jobsUrl({ grade: ["P-3"], unstated: true })).toBe("/jobs?grade=P-3&unstated=1");
    expect(jobsUrl({ category: ["health"], unstated: true })).toBe("/jobs?category=health");
    expect(normalizeSearch("unstated=1&grade=P-3&lang=French")).toBe("grade=P-3&lang=French&unstated=1");
    expect(normalizeSearch("unstated=1&category=health")).toBe("category=health");
    expect(alertStepKeep("grade=P-3&unstated=1")).toEqual([["grade", "P-3"], ["unstated", "1"]]);
    expect(activeFilterCount({ grade: ["P-3"], unstated: true })).toBe(1);
  });

  it("lists the filters it widens, in a fixed order", () => {
    expect(derivedFilters({ type: ["Consultancy"], grade: ["P-3"], category: ["health"] })).toEqual(["grade", "type"]);
    expect(derivedFilters({ q: "internship spanish" })).toEqual(["lang", "type"]);
    expect(derivedFilters({ q: "data" })).toEqual([]);
  });

  it("is named in the saved search's description", async () => {
    expect(await describeSearch("grade=P-3&unstated=1")).toBe("grade P-3, also those that don't state a grade");
    expect(await describeSearch("type=Consultancy&exp=3-5&unstated=1")).toBe("consultancy, experience 3–5 years, also those that don't state the experience required or a contract type");
  });
});

describe("language names in the search words", () => {
  it("become the language filter, like grades", () => {
    expect(languageFromWord("french")).toBe("French");
    expect(languageFromWord("Arabic")).toBe("Arabic");
    expect(languageFromWord("francophone")).toBeNull();
    expect(interpretQuery("french")).toEqual({ text: null, lang: "French" });
    expect(interpretQuery("Spanish data analyst")).toEqual({ text: "data analyst", lang: "Spanish" });
    expect(interpretQuery("portuguese consultant mozambique")).toEqual({ text: null, lang: "Portuguese", type: "Consultancy", country: "mozambique" });
    for (const l of ["Russian", "Chinese"]) expect(interpretQuery(l.toLowerCase()).lang).toBe(l);
  });

  it("take one language; a second one stays a search word, and places keep their names", () => {
    expect(interpretQuery("french arabic")).toEqual({ text: "arabic", lang: "French" });
    expect(interpretQuery("jobs in french polynesia").lang).toBeUndefined();
    // German is a filter language now (EU official languages); names that often stand for an organization stay words.
    expect(interpretQuery("german").lang).toBe("German");
    expect(interpretQuery("danish refugee council").lang).toBeUndefined();
    expect(interpretQuery("irish aid").lang).toBeUndefined();
  });

  it("never replace a language filter that is set (withSearchIntent)", () => {
    expect(withSearchIntent({ q: "french officer" })).toMatchObject({ q: "officer", lang: ["French"] });
    expect(withSearchIntent({ q: "french officer", lang: ["Arabic"] })).toMatchObject({ q: "officer", lang: ["Arabic"] });
  });
});

describe("account page: build a search from filters", () => {
  it("saves every picked filter, as the Jobs page's address would", async () => {
    const { builderLink } = await import("@/components/account-forms");
    const form = new FormData();
    for (const [k, v] of [["t", "tok"], ["link", ""], ["q", "data"], ["org", "unicef"], ["where", "region-africa"], ["grade", "P"], ["lang", "French"], ["exp", "3-5"], ["category", ""], ["type", ""], ["hidelocal", "1"]]) form.set(k, v);
    expect(builderLink(form)).toBe("/jobs?q=data&org=unicef&where=region-africa&grade=P&lang=French&exp=3-5&hidelocal=1");
    expect(normalizeSearch(builderLink(form))).toBe("q=data&org=unicef&region=africa&grade=P&lang=French&exp=3-5&hidelocal=1");
    expect(normalizeSearch(builderLink(new FormData()))).toBe("");
  });
});
