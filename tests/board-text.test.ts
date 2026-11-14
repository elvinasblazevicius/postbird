import { describe, expect, it } from "vitest";
import { stripBoardText } from "@/lib/board-text";

describe("stripBoardText", () => {
  it("removes the unjobnet footer", () => {
    const html = `<p>Apply on our site.</p><p>This position is no longer open.</p> <p> Before you apply </p> <p> We review listings for quality, but organizations may update a posting. If a detail looks wrong, <a href="https://www.unjobnet.org/#">report this job</a>. </p>`;
    expect(stripBoardText(html)).toBe("<p>Apply on our site.</p>");
  });
  it("removes Impactpool's header and notices", () => {
    const html = `<a href="https://www.impactpool.org/organizations/22/iom"> </a> IOM - International Organization for MigrationChadNationalGS-4, General Service - Locally recruited position levelSpeaks French <p>Application deadline: November 26, 2026 (13 days)</p> <p><strong>Introduction</strong></p><p> At Impactpool we do our best to provide you the most accurate info. </p>`;
    expect(stripBoardText(html)).toBe("<p><strong>Introduction</strong></p>");
  });
  it("keeps link words, drops board explainers and hidden emails", () => {
    const html = `<a href="https://untalent.org/jobs/x/abeche">Abeche</a> (<a href="https://untalent.org/jobs/x/chad">Chad</a>) <a href="https://untalent.org/jobs/x/assistant"> Show advice for this position </a> <p> This is a <b>Entry Level</b> contract. <a href="https://untalent.org/contract/entry-level"> More about Entry Level contracts</a>. </p><p>Write to <a href="https://untalent.org/cdn-cgi/l/email-protection">[email protected]</a> or wvdrc_[email protected].</p><p>See <a href="https://www.who.int/careers">WHO careers</a>.</p>`;
    const out = stripBoardText(html);
    expect(out).toContain("Abeche (Chad)");
    expect(out).not.toMatch(/untalent|Show advice|Entry Level contract|protected\]/);
    expect(out).toContain("(email address on the employer’s posting) or (email address on the employer’s posting).");
    expect(out).toContain(`<a href="https://www.who.int/careers">WHO careers</a>`);
  });
});
