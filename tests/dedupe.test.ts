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
  it("doesn't take a shared home or careers page for the same post", () => {
    expect(findDuplicates([row(1, { source_host: "untalent.org", apply_url: "https://worldbank.org" }), row(2, { source_host: "unjobnet.org", apply_url: "https://www.worldbank.org/" })]).size).toBe(0);
  });
  it("tells links apart by their query", () => {
    expect(findDuplicates([row(1, { apply_url: "https://jobs.fao.org/x?job=1" }), row(2, { apply_url: "https://jobs.fao.org/x?job=2" })]).size).toBe(0);
  });
  it("doesn't match a board's copy when the employer lists several of that title", () => {
    expect(findDuplicates([row(1, { source_host: "untalent.org", apply_url: "https://worldbank.org" }), row(2), row(3)]).size).toBe(0);
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
