import { describe, expect, it } from "vitest";
import { guidesFor } from "@/lib/guide-links";
import { EXAMPLE_STATIONS, NET_BASE, POST_ADJUSTMENT, multiplierFor, netRemuneration } from "@/lib/un-pay";

const job = (over: Partial<Parameters<typeof guidesFor>[0]>) => ({ title: "Programme Officer", grade: null, job_type: null, org_type: "UN system", ...over });

describe("guides linked from a vacancy", () => {
  it("links pay for a UN P or D grade, with the grade preset in the calculator", () => {
    expect(guidesFor(job({ grade: "P-3" }))[0]).toEqual({ href: "/guides/un-salaries?grade=P-3#calculator", label: "What a P-3 earns" });
    expect(guidesFor(job({ grade: "G-5" })).map((g) => g.href)).toEqual(["/guides/how-to-read-a-un-vacancy"]);
  });

  it("doesn't link UN pay for an NGO using the same letters", () => {
    expect(guidesFor(job({ grade: "P-2", org_type: "NGO" }))).toEqual([]);
  });

  it("links internships, volunteers and JPO guides by type and title", () => {
    expect(guidesFor(job({ job_type: "Internship" }))[0].href).toBe("/guides/un-internships");
    expect(guidesFor(job({ job_type: "Volunteer" }))[0].href).toBe("/guides/un-volunteers");
    expect(guidesFor(job({ title: "Junior Professional Officer (JPO) - Health", grade: "P-2" }))[0].href).toBe("/guides/jpo-programme");
  });

  it("links EPSO for EU institutions, and the Blue Book only for the Commission's traineeship", () => {
    expect(guidesFor(job({ org_type: "EU institution" })).map((g) => g.href)).toEqual(["/guides/epso-exams"]);
    expect(guidesFor(job({ org_type: "EU institution", job_type: "Traineeship", org_name: "European Commission" }))[0].href).toBe("/guides/eu-blue-book-traineeship");
    expect(guidesFor(job({ org_type: "EU institution", job_type: "Traineeship", org_name: "European Environment Agency" }))[0].href).toBe("/guides/epso-exams");
  });

  it("lists at most three", () => {
    expect(guidesFor(job({ title: "JPO Young Professionals Programme", job_type: "Internship", grade: "P-1" })).length).toBe(3);
  });
});

describe("UN pay figures", () => {
  it("has every duty station once, with plausible multipliers", () => {
    const names = POST_ADJUSTMENT.map((p) => p.place);
    expect(names.length).toBeGreaterThan(200);
    expect(new Set(names).size).toBe(names.length);
    for (const p of POST_ADJUSTMENT) {
      expect(p.place).not.toBe("");
      expect(p.multiplier).toBeGreaterThan(0);
      expect(p.multiplier).toBeLessThan(150);
    }
  });

  it("covers every worked example", () => {
    for (const e of EXAMPLE_STATIONS) expect(multiplierFor(e.entry), e.city).not.toBeNull();
  });

  it("adds post adjustment to net base", () => {
    expect(netRemuneration(NET_BASE["P-3"][0], 50)).toBe(Math.round(NET_BASE["P-3"][0] * 1.5));
  });
});
