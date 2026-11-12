/**
 * "Closing in the next 3 days" in paid alerts, against a real database: matching open vacancies
 * (any posting date) that close from today to 3 days ahead (UTC), soonest first, each listed at
 * most once per subscriber; never without a closing date; never in the free weekly email; an
 * email goes out with only that section; at most 10 in the section and 50 in the email.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (tables are emptied).
 * Email sending (Resend) is replaced by a stub.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Sent = { to: string; subject: string; text: string; html: string };

describe.skipIf(!TEST_DB)("paid alerts: closing soon (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let digest: typeof import("@/lib/digest");
  const sent: Sent[] = [];
  let paidId = 0, freeId = 0, seq = 0;

  /** A listing first seen `hoursAgo` hours ago, closing `closesInDays` days from today (UTC), or without a closing date (null). */
  async function addJob(title: string, hoursAgo: number, closesInDays: number | null, extra: { demo?: boolean } = {}) {
    const slug = `${title.toLowerCase().replace(/\W+/g, "-")}-${++seq}`;
    await sql`
      insert into jobs (slug, title, organization_id, apply_url, apply_host, url_hash, status, is_demo, deadline, first_seen_at, published_at)
      values (${slug}, ${title}, (select id from organizations where slug = 'closing-agency'), ${`https://example.org/${slug}`}, 'example.org',
              ${`hash-${slug}`}, 'active', ${extra.demo ?? false},
              case when ${closesInDays}::int is null then null else (now() at time zone 'utc')::date + ${closesInDays}::int end,
              now() - make_interval(hours => ${hoursAgo}), now() - make_interval(hours => ${hoursAgo}))`;
  }

  async function sub(email: string, billing: string, searches: string[], weekly = false): Promise<number> {
    const [{ id }] = await sql`
      insert into subscribers (email, status, confirmed_at, wants_alerts, weekly_email, frequency, billing_status, unsubscribe_token)
      values (${email}, 'confirmed', now(), true, ${weekly}, 'daily', ${billing}, ${`unsub-${email.replace(/\W/g, "-")}`.padEnd(24, "x")})
      returning id::int as id`;
    for (const s of searches) await sql`insert into saved_searches (subscriber_id, search, label) values (${id}, ${s}, ${`Search ${s}`})`;
    return id;
  }

  /** Moves the clock 21 hours on for the alerts: everything in the past moves back by 21 hours (closing dates stay). */
  async function nextDay() {
    await sql`update saved_searches set last_sent_at = last_sent_at - interval '21 hours'`;
    await sql`update jobs set first_seen_at = first_seen_at - interval '21 hours', published_at = published_at - interval '21 hours'`;
  }

  const closingPart = (text: string) => text.split("Closing in the next 3 days")[1] ?? "";
  const sentRows = async (id: number) =>
    (await sql`select j.title from alert_closing_sent a join jobs j on j.id = a.job_id where a.subscriber_id = ${id} order by j.title`).map((r: { title: string }) => r.title);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (!u.startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch in test: ${u}`);
      const body = JSON.parse(String(init?.body ?? "null"));
      for (const m of Array.isArray(body) ? body : [body]) sent.push({ to: m.to[0], subject: m.subject, text: m.text, html: m.html });
      return Response.json(Array.isArray(body) ? { data: body.map(() => ({ id: "stub" })) } : { id: "stub" });
    });
    sql = (await import("@/lib/db")).getSql();
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql.unsafe(`truncate subscribers, saved_searches, alert_closing_sent, jobs, job_sources, organizations, digests restart identity cascade`);
    await sql`insert into organizations (slug, name, logo_checked_at) values ('closing-agency', 'Closing Agency', now())`;
    digest = await import("@/lib/digest");

    // Listed long ago (not new), closing soon.
    await addJob("Nurse closing today", 24 * 30, 0);
    await addJob("Nurse closing in three days", 24 * 30, 3);
    await addJob("Pilot closing in two days", 24 * 30, 2);          // matches the second search
    // Never in the section.
    await addJob("Nurse closing in four days", 24 * 30, 4);         // too far ahead
    await addJob("Nurse without closing date", 24 * 30, null);      // no closing date
    await addJob("Nurse closed yesterday", 24 * 30, -1);            // closed
    await addJob("Accountant closing tomorrow", 24 * 30, 1);        // matches no search
    await addJob("Nurse demo closing tomorrow", 24 * 30, 1, { demo: true });
    // New today and closing soon: listed with the new matches, not twice.
    await addJob("Nurse new and closing", 2, 2);

    paidId = await sub("paid@example.org", "active", ["q=nurse", "q=pilot"]);
    freeId = await sub("free@example.org", "none", ["q=nurse"], true);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  beforeEach(async () => {
    sent.length = 0;
    await sql`update locks set locked_until = null, holder = null`;
  });

  it("lists matching vacancies closing from today to 3 days ahead, soonest first, after the new matches", async () => {
    const res = await digest.runAlerts();
    expect(res).toMatchObject({ status: "sent", due: 1, sent: 1, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["paid@example.org"]);
    const { text, subject } = sent[0];
    expect(subject).toBe("1 new vacancy matches your search");
    const closing = closingPart(text);
    const order = ["Nurse closing today", "Pilot closing in two days", "Nurse closing in three days"].map((t) => closing.indexOf(`${t}\n`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(closing).toMatch(/Nurse closing today\nClosing Agency · Closes \d{1,2} \w{3} \d{4}/);
    expect(text).not.toMatch(/four days|without closing date|closed yesterday|Accountant|demo/);
    // The new listing is in the new matches only.
    expect(text.split("Nurse new and closing\n")).toHaveLength(2);
    expect(closing).not.toContain("Nurse new and closing");
    expect(await sentRows(paidId)).toEqual(["Nurse closing in three days", "Nurse closing today", "Pilot closing in two days"]);
  });

  it("next day: nothing new, so an email with only closing-soon vacancies, none of them listed before", async () => {
    await nextDay();
    const res = await digest.runAlerts();
    expect(res).toMatchObject({ due: 1, sent: 1, empty: 0 });
    const [m] = sent;
    expect(m.to).toBe("paid@example.org");
    // Yesterday's new listing is not new any more; it closes in 2 days, so it is reminded once now.
    expect(m.subject).toBe("1 matching vacancy closes soon");
    expect(m.html).toContain("Vacancies closing soon");
    expect(m.html).not.toContain("New vacancies for your saved searches");
    expect(closingPart(m.text)).toContain("Nurse new and closing\n");
    expect(m.text).not.toMatch(/Nurse closing today|Pilot closing|Nurse closing in three days/);
    expect(await sentRows(paidId)).toHaveLength(4);
  });

  it("the day after: nothing new and nothing closing that wasn't listed, so no email", async () => {
    await nextDay();
    const res = await digest.runAlerts();
    expect(res).toMatchObject({ due: 1, sent: 0, empty: 1 });
    expect(sent).toHaveLength(0);
    // Still due: nothing was sent.
    const [row] = await sql`select max(last_sent_at) < now() - interval '20 hours' as due from saved_searches where subscriber_id = ${paidId}`;
    expect(row.due).toBe(true);
  });

  it("the free weekly email never has the section and records nothing", async () => {
    await addJob("Nurse weekly new", 3, null);
    const res = await digest.runDigest({ force: true });
    expect(res.sent).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["free@example.org"]);
    expect(sent[0].text).toContain("Nurse weekly new");
    expect(sent[0].text).not.toContain("Closing in the next");
    expect(sent[0].text).not.toMatch(/Nurse closing today|Pilot closing|Nurse closing in three days/);
    expect(await sentRows(freeId)).toEqual([]);
  });

  it("caps: at most 10 closing soon and 50 in all; the rest come in later emails", async () => {
    // Keep the first subscriber out of this run.
    await sql`update saved_searches set last_sent_at = now() where subscriber_id = ${paidId}`;
    for (const w of ["alpha", "beta", "gamma"]) for (let i = 0; i < 20; i++) await addJob(`${w} officer new ${i}`, 1, null);
    for (let i = 0; i < 15; i++) await addJob(`alpha closing ${i}`, 24 * 10, (i % 4));
    const capId = await sub("caps@example.org", "trialing", ["q=alpha", "q=beta", "q=gamma"]);

    const res = await digest.runAlerts();
    expect(res).toMatchObject({ due: 1, sent: 1 });
    const { text } = sent[0];
    expect((text.match(/\/jobs\//g) ?? []).length).toBe(50);
    const closing = closingPart(text);
    expect((closing.match(/\/jobs\//g) ?? []).length).toBe(10);
    // Soonest first: every listed closing job closes no later than any held back.
    const listed = await sql`select max(j.deadline) as d from alert_closing_sent a join jobs j on j.id = a.job_id where a.subscriber_id = ${capId}`;
    const held = await sql`select min(j.deadline) as d from jobs j where j.title like 'alpha closing %' and not exists (select 1 from alert_closing_sent a where a.subscriber_id = ${capId} and a.job_id = j.id)`;
    expect(new Date(listed[0].d).getTime()).toBeLessThanOrEqual(new Date(held[0].d).getTime());
    expect(await sentRows(capId)).toHaveLength(10);
    // 40 new matches: the first two searches list 20 each, the third none but keeps "See all".
    expect(text).toContain("See all 20:");

    sent.length = 0;
    await sql`update locks set locked_until = null, holder = null`;
    await nextDay();
    await sql`update saved_searches set last_sent_at = now() where subscriber_id = ${paidId}`;
    const next = await digest.runAlerts();
    expect(next).toMatchObject({ due: 1, sent: 1 });
    expect(sent[0].subject).toBe("5 matching vacancies close soon");
    expect((closingPart(sent[0].text).match(/\/jobs\//g) ?? []).length).toBe(5);
    expect(await sentRows(capId)).toHaveLength(15);
  });
});
