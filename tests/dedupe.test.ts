import { describe, expect, it } from "vitest";
import { findDuplicates, type DedupeRow } from "@/lib/feeds/dedupe";

const row = (id: number, o: Partial<DedupeRow> = {}): DedupeRow => ({ id, organization_id: 1, title: "Officer, Facilities and Operations", country_code: "KE", deadline: null, apply_url: `https://jobs.example.org/${id}`, source_host: "jobs.example.org", ...o });

describe("findDuplicates", () => {
  it("keeps the employer's dated copy and takes down a job board's", () => {
    const d = findDuplicates([row(1, { source_host: "untalent.org" }), row(2, { deadline: "2026-12-03" })]);
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
  it("reads titles without numbers or grade codes", () => {
    expect([...findDuplicates([
      row(1, { title: "Education Officer, (NO-1), Chilpancingo, Guerrero", source_host: "unjobnet.org", deadline: "2026-11-22" }),
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
