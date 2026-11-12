/**
 * Alert email templates (src/lib/email-templates.ts): the per-email cap on listed
 * vacancies, compact rows and the HTML size. Gmail clips messages over 102 KB of
 * HTML and hides everything after the cut, including the unsubscribe link.
 */
import { describe, expect, it } from "vitest";
import { alertEmail, capGroups, CLOSING_SOON_MAX, MAX_JOBS_PER_EMAIL, weeklyEmail, type AlertGroup } from "@/lib/email-templates";
import type { JobListItem } from "@/lib/jobs";

const LONG = "Senior Programme Management Officer for Monitoring, Evaluation, Accountability and Learning (MEAL) in Humanitarian Coordination & Resilience Programmes <Regional Hub>, with travel to field locations across the Sahel";

function job(i: number, over: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 1_000_000 + i,
    slug: `senior-programme-management-officer-monitoring-evaluation-accountability-learning-humanitarian-coordination-${i}`,
    title: `${LONG} #${i}`,
    org_name: "United Nations Office for the Coordination of Humanitarian Affairs & Partners",
    org_slug: "ocha",
    org_short: "OCHA",
    org_logo: null,
    country_code: "BF",
    city: "Ouagadougou",
    location_text: null,
    is_remote: false,
    category: "programme-management",
    job_type: "Fixed term",
    grade: "P-4",
    published_at: new Date("2026-11-08T00:00:00Z"),
    first_seen_at: new Date("2026-11-08T00:00:00Z"),
    deadline: "2026-12-01",
    status: "active",
    is_demo: false,
    ...over,
  };
}

const group = (n: number, from: number, total = 500): AlertGroup => ({
  label: `“monitoring evaluation accountability learning humanitarian” at a very long organization name, in West and Central Africa, grade P-4 #${from}`,
  url: `https://postbird.nuevanova.com/jobs?q=monitoring+evaluation+accountability+learning&org=ocha&region=west-and-central-africa&grade=P-4&posted=1&utm_source=alert&utm_medium=email&n=${from}`,
  jobs: Array.from({ length: n }, (_, i) => job(from + i)),
  total,
});

const links = { accountUrl: `https://postbird.nuevanova.com/account?t=${"a".repeat(64)}`, unsubscribeUrl: `https://postbird.nuevanova.com/alerts/unsubscribe?token=${"b".repeat(32)}` };

describe("alert emails", () => {
  it("caps listed vacancies at 50 across searches, shared evenly; every search keeps See all", () => {
    const capped = capGroups([group(20, 0), group(20, 100), group(20, 200), group(20, 300), group(20, 400)]);
    expect(capped.map((g) => g.jobs.length)).toEqual([10, 10, 10, 10, 10]);
    // What a short search doesn't use goes to the others.
    expect(capGroups([group(3, 0), group(20, 100), group(20, 200)], 23).map((g) => g.jobs.length)).toEqual([3, 10, 10]);
    // A vacancy matching several searches is listed once, under the first.
    expect(capGroups([group(4, 0), group(4, 2)]).map((g) => g.jobs.length)).toEqual([4, 2]);
    expect(capped.reduce((n, g) => n + g.jobs.length, 0)).toBe(MAX_JOBS_PER_EMAIL);
    expect(capped.every((g) => g.total === 500)).toBe(true);

    const email = alertEmail({ groups: [group(20, 0), group(20, 100), group(20, 200), group(20, 300), group(20, 400)], frequency: "daily", ...links });
    expect((email.html.match(/utm_source=alert&amp;utm_medium=email/g) ?? []).length).toBeGreaterThanOrEqual(MAX_JOBS_PER_EMAIL);
    // Each of the 5 searches keeps its "See all" link.
    expect((email.html.match(/See all 500 matches/g) ?? []).length).toBe(5);
    expect((email.text.match(/See all 500:/g) ?? []).length).toBe(5);
    expect(email.subject).toBe("2500 new vacancies match your searches");
  });

  it("never drops a vacancy because an earlier search fetched it without listing it", () => {
    // A broad search first (20 fetched), then a narrow one whose 3 matches are the broad one's last rows.
    const broad = group(20, 0, 100);
    const narrow: AlertGroup = { ...group(0, 0, 3), label: "narrow", jobs: [job(19), job(18), job(17)] };
    const other = group(20, 100);
    const capped = capGroups([broad, narrow, other], 6);
    const ids = (gs: AlertGroup[]) => gs.map((g) => g.jobs.map((j) => j.id - 1_000_000));
    expect(ids(capped)).toEqual([[0, 1], [19, 18], [100, 101]]);
    // Rows the email lists elsewhere (closing soon) are skipped, not repeated.
    expect(ids(capGroups([group(4, 0)], 50, [1_000_001, 1_000_002]))).toEqual([[0, 3]]);
  });

  it("counts a vacancy that matches many searches once, and says where its rows are", () => {
    const groups = Array.from({ length: 20 }, (_, k): AlertGroup => ({ ...group(0, 0, 1), label: `search ${k + 1}`, jobs: [job(7)] }));
    const email = alertEmail({ groups, frequency: "daily", ...links });
    expect(email.subject).toBe("1 new vacancy matches your searches");
    expect((email.html.match(/Its new matches are already listed in this email\./g) ?? []).length).toBe(19);
    expect(email.html).not.toContain("See all 1 matches");
  });

  it("a subscriber with all 20 searches full still gets one email under 90 KB, every search listed", () => {
    const closing = Array.from({ length: CLOSING_SOON_MAX }, (_, i) => job(9000 + i, { deadline: "2026-11-10" }));
    const groups = Array.from({ length: 20 }, (_, k) => group(20, k * 100));
    const email = alertEmail({ groups, closing, frequency: "daily", ...links });
    expect(Buffer.byteLength(email.html, "utf8")).toBeLessThan(90 * 1024);
    // 40 rows for 20 searches: two each, and all 20 "See all" links.
    expect(capGroups(groups, MAX_JOBS_PER_EMAIL - CLOSING_SOON_MAX).map((g) => g.jobs.length)).toEqual(Array(20).fill(2));
    expect((email.html.match(/See all 500 matches/g) ?? []).length).toBe(20);
  });

  it("a maximal paid alert (5 searches × 20 long rows and a full closing-soon section) stays under 90 KB of HTML, with the unsubscribe link", () => {
    const closing = Array.from({ length: CLOSING_SOON_MAX }, (_, i) => job(900 + i, { deadline: "2026-11-10" }));
    const email = alertEmail({ groups: [0, 1, 2, 3, 4].map((k) => group(20, k * 100)), closing, frequency: "daily", ...links });
    const bytes = Buffer.byteLength(email.html, "utf8");
    expect(bytes).toBeLessThan(90 * 1024);
    expect(email.html).toContain(links.unsubscribeUrl);
    expect(email.html).toContain("Closing in the next 3 days");
    // Still 50 listed in all: the 10 closing soon, and 40 new matches.
    expect((email.text.match(/\/jobs\/senior-programme/g) ?? []).length).toBe(MAX_JOBS_PER_EMAIL);
    expect((email.html.match(/utm_content=closing/g) ?? []).length).toBe(CLOSING_SOON_MAX);
  });

  it("closing soon: listed after the new matches with the closing date, kept within the 50 cap, at most 10", () => {
    const closing = Array.from({ length: 12 }, (_, i) => job(700 + i, { title: `Closing role ${i}`, deadline: "2026-11-11" }));
    const email = alertEmail({ groups: [group(20, 0, 20), group(20, 100, 20), group(20, 200, 20)], closing, frequency: "daily", ...links });
    expect(email.subject).toBe("60 new vacancies match your searches");
    // 10 closing soon leave 40 for new matches, shared between the three searches: 14, 13 and 13.
    expect(email.text).toContain("#13\n");
    expect(email.text).not.toContain("#14\n");
    expect(email.text).toContain("#212\n");
    expect(email.text).not.toContain("#213\n");
    expect(email.text.indexOf("Closing in the next 3 days")).toBeGreaterThan(email.text.indexOf("#212\n"));
    expect(email.text).toContain("Closing role 0\nUnited Nations Office for the Coordination of Humanitarian Affairs & Partners · Ouagadougou, Burkina Faso · P-4 · Closes 11 Nov 2026");
    expect(email.text).toContain("Closing role 9\n");
    expect(email.text).not.toContain("Closing role 10");
    expect((email.text.match(/\/jobs\//g) ?? []).length).toBe(MAX_JOBS_PER_EMAIL);
    // Without closing-soon jobs the email is unchanged.
    const plain = alertEmail({ groups: [group(2, 0, 2)], frequency: "daily", ...links });
    expect(plain.html).not.toContain("Closing in the next");
  });

  it("an email with only closing-soon vacancies says so in the subject and heading", () => {
    const one = alertEmail({ groups: [], closing: [job(1, { title: "Data Officer" })], frequency: "daily", ...links });
    expect(one.subject).toBe("1 matching vacancy closes soon");
    const three = alertEmail({ groups: [], closing: [job(1), job(2), job(3)], frequency: "weekly", ...links });
    expect(three.subject).toBe("3 matching vacancies close soon");
    expect(three.html).toContain("Vacancies closing soon");
    expect(three.text).toContain("Nothing new matches your saved searches this week");
    expect(three.html).not.toContain("New vacancies for your saved searches");
    expect(three.html).toContain(links.unsubscribeUrl);
  });

  it("shows compact rows: title link, then organization · location · grade · closing date (only what is known)", () => {
    const email = alertEmail({ groups: [{ ...group(1, 0, 1), jobs: [job(1, { title: "Data Officer" }), job(2, { title: "Driver", grade: null, deadline: null, city: null, country_code: null })] }], frequency: "daily", ...links });
    expect(email.text).toContain("Data Officer\nUnited Nations Office for the Coordination of Humanitarian Affairs & Partners · Ouagadougou, Burkina Faso · P-4 · Closes 1 Dec 2026");
    expect(email.text).toContain("Driver\nUnited Nations Office for the Coordination of Humanitarian Affairs & Partners\n");
    // Escaped in HTML.
    expect(email.html).not.toContain("<Regional Hub>");
  });

  it("labels local-only posts in the row as the site's lists do: National Officer posts for nationals only", () => {
    const email = alertEmail({ groups: [{ ...group(3, 0, 3), jobs: [
      job(1, { title: "Programme Analyst", grade: "NO-B" }),
      job(2, { title: "Driver", grade: "G-3" }),
      job(3, { title: "Data Officer" }),
    ] }], frequency: "daily", ...links });
    expect(email.text).toContain("Programme Analyst\nUnited Nations Office for the Coordination of Humanitarian Affairs & Partners · Ouagadougou, Burkina Faso · National Officer B · Nationals only · Closes 1 Dec 2026");
    expect(email.text).toContain("Driver\nUnited Nations Office for the Coordination of Humanitarian Affairs & Partners · Ouagadougou, Burkina Faso · G-3 · Local post · Closes 1 Dec 2026");
    expect(email.text).not.toMatch(/Data Officer\n[^\n]*(Local post|Nationals only)/);
  });

  it("the free weekly email lists what it is given (10 at most from the sender), uses the total in the subject and offers daily alerts once", () => {
    const email = weeklyEmail({ group: group(10, 0, 37), search: "q=data", trialUrl: "https://postbird.nuevanova.com/pricing/trial?search=q%3Ddata", ...links });
    expect(email.subject).toBe("37 new vacancies match your search this week");
    expect((email.text.match(/\/jobs\/senior-programme/g) ?? []).length).toBe(10);
    expect(email.text).toContain("See all 37:");
    expect((email.html.match(/with up to 20 searches/g) ?? []).length).toBe(1);
    expect(email.html).toContain("/pricing/trial?search=q%3Ddata");
    expect(email.html).toContain(links.unsubscribeUrl);
    expect(email.html).toContain(links.accountUrl);
    expect(Buffer.byteLength(email.html, "utf8")).toBeLessThan(90 * 1024);
    const all = weeklyEmail({ group: group(1, 0, 1), search: "", trialUrl: "https://postbird.nuevanova.com/pricing/trial", ...links });
    expect(all.subject).toBe("1 new international vacancy this week");
  });
});
