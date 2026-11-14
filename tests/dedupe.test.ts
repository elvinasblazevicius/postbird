import { describe, expect, it } from "vitest";
import { findDuplicates, type DedupeRow } from "@/lib/feeds/dedupe";

const row = (id: number, o: Partial<DedupeRow> = {}): DedupeRow => ({ id, organization_id: 1, title: "Officer, Facilities and Operations", country_code: "KE", deadline: null, apply_url: `https://jobs.example.org/vacancy/${100000 + id}`, source_host: "jobs.example.org", ...o });

describe("findDuplicates", () => {
  it("keeps the employer's dated copy and takes down a job board's", () => {
    const d = findDuplicates([row(1, { source_host: "untalent.org", apply_url: "https://untalent.org/job/officer-facilities" }), row(2, { deadline: "2026-12-03" })]);
    expect([...d]).toEqual([[1, 2]]);
  });
  it("matches copies with the same link", () => {
    expect([...findDuplicates([row(1, { apply_url: "https://x.org/a" }), row(2, { apply_url: "https://www.x.org/a/" })])]).toEqual([[2, 1]]);
  });
  it("takes down a copy that only links to a careers page or a guide, keeping the one that opens the posting", () => {
    expect([...findDuplicates([row(1, { source_host: "untalent.org", apply_url: "https://worldbank.org" }), row(2, { source_host: "unjobnet.org", apply_url: "https://www.worldbank.org/" })])]).toEqual([[2, 1]]);
    const d = findDuplicates([
      row(1, { title: "Unit Head (Chemicals, Radiation and Health)", apply_url: "https://careers.who.int/careersection/ex/jobdetail.ftl?job=2604422", country_code: null }),
      row(2, { title: "Unit Head (Chemicals, Radiation and Health)", apply_url: "https://www.who.int/publications/m/item/stellis-user-guide-how-to-apply-to-who-job-opportunities?ua=1", country_code: "CH" }),
    ]);
    expect([...d]).toEqual([[2, 1]]);
    // An employer listing two posts of a title (two vacancy numbers) and a board copy linking to its careers site.
    const iom = findDuplicates([
      row(215, { title: "Asistente de Terreno (RVA)", source_host: "untalent.org", apply_url: "https://fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001", country_code: null }),
      row(382, { title: "Asistente de Terreno (RVA)", apply_url: "https://fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/24080", country_code: "VE", deadline: "2026-11-18" }),
      row(383, { title: "Asistente de Terreno (RVA)", apply_url: "https://fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/24082", country_code: "VE", deadline: "2026-11-17" }),
    ]);
    expect([...iom]).toEqual([[215, 382]]);
  });
  it("matches the number in two forms of the same link", () => {
    expect([...findDuplicates([
      row(1248, { title: "Communications Analyst (Open to internal and external candidates)", apply_url: "https://estm.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/job/38070" }),
      row(1277, { title: "Communications Analyst", apply_url: "https://estm.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/38070" }),
    ])]).toEqual([[1277, 1248]]);
    expect([...findDuplicates([
      row(852, { title: "Health Innovation Consultant, UNICEF Office of Innovation (OOI) – Stockholm, Sweden, 8 months", apply_url: "https://jobs.unicef.org/jobs/health-innovation-consultant-unicef-office-of-innovation-ooi-stockholm-sweden-8-months-remote-with-travel-596957-sweden", country_code: "SE" }),
      row(777, { title: "Health Innovation Consultant, UNICEF Office of Innovation (OOI)", apply_url: "https://jobs.unicef.org/cw/en-us/job/596957", country_code: null }),
    ])]).toEqual([[852, 777]]);
  });
  it("matches a bare copy of a long title, and two copies with the same closing date and country", () => {
    const t = "Junior Electrical Systems Asset Manager";
    expect([...findDuplicates([
      row(1239, { title: t, apply_url: "https://jobs.smartrecruiters.com/CERN/744000163511846", country_code: "CH", deadline: "2026-12-03" }),
      row(1257, { title: t, apply_url: "https://careers.cern/jobs/en-el-mo-2026-253-grae-2/", country_code: null }),
    ])]).toEqual([[1257, 1239]]);
    expect(findDuplicates([row(1, { title: "Agronomist", country_code: null }), row(2, { title: "Agronomist", country_code: "IT", deadline: "2026-12-01" })]).size).toBe(0);
    expect([...findDuplicates([
      row(1337, { title: "Education Officer, (NO-1), Chilpancingo, Guerrero", apply_url: "https://jobs.unicef.org/jobs/education-officer-no-1-ta-364-days-00138514-chilpancingo", country_code: "MX", deadline: "2026-11-22" }),
      row(1310, { title: "Education Officer, Chilpancingo, Guerrero", apply_url: "https://jobs.unicef.org/cw/en-us/job/596992", country_code: "MX", deadline: "2026-11-22" }),
    ])]).toEqual([[1337, 1310]]);
  });
  it("keeps posts apart whose links of one kind give different vacancy numbers", () => {
    const t = "Finance and Administration Assistant";
    expect(findDuplicates([
      row(1186, { title: t, country_code: "KH", deadline: "2026-12-01", apply_url: "https://worldvision.wd1.myworkdayjobs.com/en-US/WVI/job/Phnom-Srok/Finance-and-Administration-Assistant_JR53993" }),
      row(1196, { title: t, country_code: "KH", deadline: "2026-12-01", apply_url: "https://worldvision.wd1.myworkdayjobs.com/en-US/WVI/job/Kralanh/Finance-and-Administration-Assistant_JR53869" }),
    ]).size).toBe(0);
  });
  it("matches a vacancy number in a title, and one number on a recruitment site shared by two employers", () => {
    expect(findDuplicates([
      row(1, { title: "National consultant, First Foods Action Plan, 596955", apply_url: "https://jobs.unicef.org/cw/en-us/job/596955" }),
      row(2, { title: "National consultant – First Foods Action Plan 596955", apply_url: "https://jobs.unicef.org/jobs/national-consultant-first-foods-sierra-leone" }),
    ]).size).toBe(1);
    expect(findDuplicates([
      row(1248, { organization_id: 1, title: "Communications Analyst", apply_url: "https://estm.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/job/38070" }),
      row(1277, { organization_id: 2, title: "Communications Analyst", apply_url: "https://estm.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/38070" }),
    ]).size).toBe(1);
  });
  it("judges a careers-page link by the title, and never merges common posts by it", () => {
    const t = "Roster of Consultants – Asia-Pacific Hub of the Alliance for Transformative Action on Climate and Health (ATACH), Seoul";
    expect(findDuplicates([
      row(795, { title: t, country_code: "KR", deadline: "2026-11-26", apply_url: "https://careers.who.int/careersection/ex/jobdetail.ftl?job=2604783" }),
      row(937, { title: t, country_code: "KR", source_host: "untalent.org", apply_url: "https://www.who.int/careers/diversity-equity-and-inclusion" }),
    ]).size).toBe(1);
    // A common post the employer lists twice: a board copy linking to its careers site could be either, or another.
    expect(findDuplicates([
      row(336, { title: "Driver", country_code: null, source_host: "untalent.org", apply_url: "https://www.iom.int/careers" }),
      row(6, { title: "Driver", country_code: "CD", deadline: "2026-11-16", apply_url: "https://iom.example/job/24002" }),
      row(7, { title: "Driver", country_code: "NG", deadline: "2026-11-24", apply_url: "https://iom.example/job/24019" }),
    ]).size).toBe(0);
  });
  it("matches one vacancy in two of the employer's feeds, and the same posting id in two link forms", () => {
    const t = "Makani Programme Learning Support consultant 1 x math's subject specialist, Amman, Jordan, remote 6 months";
    expect(findDuplicates([
      row(1131, { title: t, country_code: "JO", apply_url: "https://jobs.unicef.org/jobs/makani-programme-learning-support-consultant-amman-jordan" }),
      row(1243, { title: t, country_code: "JO", apply_url: "https://jobs.unicef.org/cw/en-us/job/596976" }),
    ]).size).toBe(1);
    expect(findDuplicates([
      row(758, { title: "Internship – Contaminant Dynamics", country_code: null, apply_url: "http://iaea.taleo.net/careersection/ex/jobdetail.ftl?lang=en&job=TAL-NAFA20261014-001" }),
      row(928, { title: "Internship – Contaminant Dynamics", country_code: null, apply_url: "https://iaea.taleo.net/careersection/ex/jobdetail.ftl?job=TAL-NAFA20261014-001" }),
    ]).size).toBe(1);
    expect(findDuplicates([
      row(1061, { title: "International Consultant Pool: Employee Relations", apply_url: "https://jobs.jobvite.com/prosperglobal/job/oP86Afwn" }),
      row(1207, { title: "International Consultant Pool: Employee Relations", apply_url: "https://jobs.jobvite.com/mercycorps/job/oP86Afwn" }),
    ]).size).toBe(1);
  });
  it("reads titles without numbers or grade codes", () => {
    expect([...findDuplicates([
      row(1, { title: "Education Officer, (NO-1), Chilpancingo, Guerrero", source_host: "unjobnet.org", apply_url: "https://www.unjobnet.org/jobs/detail/education-officer", deadline: "2026-11-22" }),
      row(2, { title: "Education Officer, Chilpancingo, Guerrero", deadline: "2026-11-22" }),
    ])]).toEqual([[1, 2]]);
  });
  it("matches the same vacancy number at the same employer across titles", () => {
    const d = findDuplicates([row(1, { title: "UNITAID Team Lead (Communications)", reference: "2601234" }), row(2, { title: "Team Lead (Communications)", reference: "2601234", deadline: "2026-12-01" })]);
    expect([...d]).toEqual([[1, 2]]);
  });
  it("tells links apart by their query", () => {
    expect(findDuplicates([row(1, { apply_url: "https://jobs.fao.org/x?job=1" }), row(2, { apply_url: "https://jobs.fao.org/x?job=2" })]).size).toBe(0);
  });
  it("doesn't match a board's copy with its own posting link when the employer lists several of that title", () => {
    expect(findDuplicates([row(1, { source_host: "untalent.org", apply_url: "https://worldbank.org/jobs/E-T-Consultant-99999" }), row(2), row(3)]).size).toBe(0);
  });
  it("leaves separate posts of the employer alone", () => {
    expect(findDuplicates([row(1), row(2), row(3)]).size).toBe(0);
  });
  it("leaves contradicting dates, places and missing employers alone", () => {
    expect(findDuplicates([row(1, { source_host: "untalent.org", deadline: "2026-12-01" }), row(2, { deadline: "2026-12-03" })]).size).toBe(0);
    expect(findDuplicates([row(1, { source_host: "untalent.org", country_code: "UG" }), row(2)]).size).toBe(0);
    expect(findDuplicates([row(1, { source_host: "untalent.org", organization_id: null }), row(2, { organization_id: null })]).size).toBe(0);
  });
});
