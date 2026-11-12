/**
 * The vacancy-page step of the scheduled import: for open jobs whose employer page hasn't been
 * read yet (or is due a retry), read it once and fill in the facts the feed left out
 * (src/lib/feeds/vacancy-page.ts). Polite by design: robots.txt is obeyed for our name or "*",
 * job boards and PDFs are never fetched, one request per website at a time with a pause between
 * them, a named user agent, a time budget and a per-run cap (IMPORT_SETTINGS.vacancyPages).
 * Only empty fields are filled; the page's own facts are also stored (page_*) so later
 * re-imports keep them (withPageFacts in sync.ts). A closing date found here that has passed is
 * closed by the import's expiry step, which runs right after.
 */
import { IMPORT_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { hostOf, isListingSite } from "./url";
import { parseRobots, robotsAllows, type RobotsRules } from "./robots";
import { looksBuiltByScript, openRenderer } from "./rendered-page";
import { askDeepSeek, checkFacts } from "./ai-extract";
import { htmlToText } from "@/lib/text";
import { EMPTY_FACTS, factsFromPage, factsFromSystem, hasFacts, mainContentHtml, pageSaysClosed, plausibleDeadline, systemApiUrl, systemSaysClosed, type PageFacts } from "./vacancy-page";

const S = IMPORT_SETTINGS.vacancyPages;

export type EnrichResult = {
  checked: number; withFacts: number; nothing: number; blocked: number; errors: number; skipped: number;
  /** Pages built in the browser that were read with a headless browser (of them, how many gave facts). */
  rendered: number; renderedWithFacts: number;
  /** Pages the AI read for details the rules missed; values it filled; its token use. */
  ai: { asked: number; filled: number; rejected: number; tokensIn: number; tokensOut: number };
  filled: { deadline: number; place: number; jobType: number; grade: number; experience: number; languages: number };
  via: Record<string, number>;
};

type DueJob = {
  id: number; title: string; apply_url: string; apply_host: string;
  deadline: string | null; country_code: string | null; location_text: string | null; job_type: string | null;
  grade: string | null; min_experience_years: number | null; languages: string[] | null; page_attempts: number;
};

class BlockedByRobots extends Error {}
class NotReadable extends Error {}
/** The page's HTML is an empty shell filled in by JavaScript. */
class BuiltByScript extends Error {}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel().catch(() => {}); throw new NotReadable("page too large"); }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new NotReadable("page too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function get(url: string, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), S.timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": S.userAgent, accept, "accept-language": "en" } });
  } finally {
    clearTimeout(timer);
  }
}

/** robots.txt per host for this run: missing → allowed; unreadable → not allowed (cautious). */
export async function robotsFor(host: string, cache: Map<string, RobotsRules>): Promise<RobotsRules> {
  const hit = cache.get(host);
  if (hit) return hit;
  let rules: RobotsRules;
  try {
    const res = await get(`https://${host}/robots.txt`, "text/plain");
    if (res.status === 404 || res.status === 410) rules = "allow-all";
    else if (res.ok) rules = parseRobots(await readCapped(res, 500_000), S.robotsName);
    else rules = "deny-all";
  } catch {
    rules = "deny-all";
  }
  cache.set(host, rules);
  return rules;
}

export async function allowed(url: string, cache: Map<string, RobotsRules>): Promise<boolean> {
  const u = new URL(url);
  return robotsAllows(await robotsFor(u.host, cache), u.pathname + u.search);
}

/** Reads one job's facts: a recruitment system's job data when its address shows one, else the page. */
async function readFacts(job: DueJob, cache: Map<string, RobotsRules>): Promise<{ facts: PageFacts | null; html: string | null }> {
  const system = systemApiUrl(job.apply_url);
  if (system) {
    if (!(await allowed(system.api, cache))) throw new BlockedByRobots();
    const res = await get(system.api, "application/json");
    if (!res.ok) throw new NotReadable(`HTTP ${res.status}`);
    const facts = factsFromSystem(system.via, JSON.parse(await readCapped(res, S.maxBytes)));
    if (hasFacts(facts)) return { facts, html: null };
    // Some systems' pages also carry a JobPosting record; fall through to the page.
  }
  if (!(await allowed(job.apply_url, cache))) throw new BlockedByRobots();
  const res = await get(job.apply_url, "text/html,application/xhtml+xml");
  if (!res.ok) throw new NotReadable(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/html|xml/i.test(type)) { await res.body?.cancel().catch(() => {}); throw new NotReadable("not an HTML page"); }
  // A redirect to a job board (or an expired-vacancy page on one) is not the employer's page.
  if (isListingSite(hostOf(res.url))) { await res.body?.cancel().catch(() => {}); throw new NotReadable("redirected to a job board"); }
  const html = await readCapped(res, S.maxBytes);
  const facts = factsFromPage(job.title, job.apply_url, html);
  if (!hasFacts(facts) && looksBuiltByScript(html)) throw new BuiltByScript();
  return { facts, html };
}

/**
 * Details the rules left empty (closing date, country, contract type, grade), read by the AI from
 * the page text and kept only when they pass checkFacts (the quote must be on the page). Only on a
 * job's first reading, at most `S.aiPerRun` pages per run, and only with DEEPSEEK_API_KEY set.
 */
async function withAi(job: DueJob, facts: PageFacts | null, html: string | null, r: EnrichResult): Promise<PageFacts | null> {
  if (!html || !process.env.DEEPSEEK_API_KEY || job.page_attempts > 0 || r.ai.asked >= S.aiPerRun) return facts;
  const f: PageFacts = facts ?? { ...EMPTY_FACTS, via: "text" };
  const needDate = !job.deadline && !f.deadline;
  const needPlace = !job.country_code && !job.location_text && !f.countryCode && !f.locationText;
  const needType = !job.job_type && !f.jobType;
  const needGrade = !job.grade && !f.grade;
  if (!needDate && !needPlace && !needType && !needGrade) return facts;
  const text = htmlToText(mainContentHtml(html));
  if (text.length < 300) return facts;
  try {
    const ai = await askDeepSeek(job.title, text);
    if (!ai) return facts;
    r.ai.asked++; r.ai.tokensIn += ai.usage.input; r.ai.tokensOut += ai.usage.output;
    const c = checkFacts(ai.facts, text);
    r.ai.rejected += c.rejected.length;
    const out: PageFacts = { ...f };
    if (needDate && c.deadline) { out.deadline = c.deadline; r.ai.filled++; }
    if (needPlace && c.countryCode) { out.countryCode = c.countryCode; r.ai.filled++; }
    if (needType && c.contractType) { out.jobType = c.contractType; r.ai.filled++; }
    if (needGrade && c.grade) { out.grade = c.grade; r.ai.filled++; }
    return out;
  } catch {
    return facts; // the AI being down never stops the import
  }
}

async function save(job: DueJob, result: string, f: PageFacts | null, r: EnrichResult): Promise<void> {
  const deadline = plausibleDeadline(f?.deadline ?? null);
  const placeEmpty = !job.country_code && !job.location_text;
  if (f) {
    if (!job.deadline && deadline) r.filled.deadline++;
    if (placeEmpty && (f.countryCode || f.locationText)) r.filled.place++;
    if (!job.job_type && f.jobType) r.filled.jobType++;
    if (!job.grade && f.grade) r.filled.grade++;
    if (job.min_experience_years == null && f.experienceYears != null) r.filled.experience++;
    if (!job.languages?.length && f.languages?.length) r.filled.languages++;
  }
  await sql`
    update jobs set
      page_checked_at = now(), page_attempts = page_attempts + 1, page_result = ${result},
      page_deadline = ${deadline}, page_country_code = ${f?.countryCode ?? null}, page_city = ${f?.city ?? null},
      page_location_text = ${f?.locationText?.slice(0, 200) ?? null}, page_job_type = ${f?.jobType ?? null},
      page_grade = ${f?.grade ?? null}, page_experience_years = ${f?.experienceYears ?? null}, page_languages = ${f?.languages ?? null},
      deadline = coalesce(deadline, ${deadline}),
      country_code = case when country_code is null and location_text is null then ${f?.countryCode ?? null} else country_code end,
      city = case when country_code is null and location_text is null then ${f?.city ?? null} else city end,
      location_text = case when country_code is null and location_text is null then ${f?.locationText?.slice(0, 200) ?? null} else location_text end,
      job_type = coalesce(job_type, ${f?.jobType ?? null}),
      grade = coalesce(grade, ${f?.grade ?? null}),
      min_experience_years = coalesce(min_experience_years, ${f?.experienceYears ?? null}),
      languages = case when coalesce(cardinality(languages), 0) = 0 then ${f?.languages ?? null} else languages end,
      updated_at = case when ${f ? hasFacts(f) : false} then now() else updated_at end
    where id = ${job.id}`;
}

export async function enrichFromVacancyPages(opts: { limit?: number; budgetMs?: number } = {}): Promise<EnrichResult> {
  const r: EnrichResult = { checked: 0, withFacts: 0, nothing: 0, blocked: 0, errors: 0, skipped: 0, rendered: 0, renderedWithFacts: 0, ai: { asked: 0, filled: 0, rejected: 0, tokensIn: 0, tokensOut: 0 }, filled: { deadline: 0, place: 0, jobType: 0, grade: 0, experience: 0, languages: 0 }, via: {} };
  // Tests never visit real websites (the readers have their own unit tests).
  if (!S.enabled || process.env.VITEST) return r;
  const started = Date.now();
  const budget = opts.budgetMs ?? S.budgetMs;
  const due = await sql<DueJob[]>`
    select id::int as id, title, apply_url, apply_host, deadline::text as deadline, country_code, location_text, job_type, grade, min_experience_years, languages, page_attempts
      from jobs
     where status = 'active' and not is_demo
       and (page_checked_at is null
            or (page_result = 'none' and page_attempts < ${S.maxAttempts}
                and page_checked_at < now() - make_interval(days => ${S.retryDays}))
            or (page_result = 'error' and page_attempts < ${S.maxAttempts}
                and page_checked_at < now() - make_interval(hours => ${S.retryErrorHours})))
     order by page_checked_at nulls first, first_seen_at desc
     limit ${opts.limit ?? S.perRun}`;

  // One queue per website; each worker takes a whole website, so no site sees two requests at once.
  const byHost = new Map<string, DueJob[]>();
  for (const j of due) {
    const host = (() => { try { return new URL(j.apply_url).host; } catch { return j.apply_host; } })();
    byHost.set(host, [...(byHost.get(host) ?? []), j]);
  }
  const hosts = [...byHost.keys()];
  const robots = new Map<string, RobotsRules>();
  const builtByScript: DueJob[] = [];

  async function worker() {
    for (let host = hosts.shift(); host !== undefined; host = hosts.shift()) {
      for (const job of byHost.get(host)!) {
        if (Date.now() - started > budget) return;
        r.checked++;
        if (isListingSite(job.apply_host) || /\.pdf(?:$|[?#])/i.test(job.apply_url)) {
          r.skipped++;
          await save(job, "skipped", null, r);
          continue;
        }
        try {
          const read = await readFacts(job, robots);
          const facts = await withAi(job, read.facts, read.html, r);
          if (facts && hasFacts(facts)) {
            r.withFacts++;
            r.via[facts.via] = (r.via[facts.via] ?? 0) + 1;
            await save(job, "ok", facts, r);
          } else {
            r.nothing++;
            await save(job, "none", null, r);
          }
        } catch (e) {
          if (e instanceof BuiltByScript) builtByScript.push(job); // read with a browser below
          else if (e instanceof BlockedByRobots) { r.blocked++; await save(job, "blocked", null, r); }
          else { r.errors++; await save(job, "error", null, r); }
        }
        await new Promise((res) => setTimeout(res, S.perHostDelayMs));
      }
    }
  }
  await Promise.all(Array.from({ length: S.concurrency }, worker));
  await readBuiltByScript(builtByScript, Date.now(), S.browserBudgetMs, r);
  return r;
}

/** Pages whose text arrives through JavaScript: one headless browser, one page at a time. */
async function readBuiltByScript(jobs: DueJob[], started: number, budget: number, r: EnrichResult): Promise<void> {
  if (!jobs.length) return;
  const renderer = Date.now() - started < budget ? await openRenderer() : null;
  try {
    for (const job of jobs) {
      const html = renderer && Date.now() - started < budget ? await renderer.render(job.apply_url) : null;
      const facts = html ? await withAi(job, factsFromPage(job.title, job.apply_url, html), html, r) : null;
      if (html) r.rendered++;
      if (facts && hasFacts(facts)) {
        r.withFacts++; r.renderedWithFacts++;
        r.via[facts.via] = (r.via[facts.via] ?? 0) + 1;
        await save(job, "ok", facts, r);
      } else {
        r.nothing++;
        await save(job, "none", null, r);
      }
      if (renderer) await new Promise((res) => setTimeout(res, S.perHostDelayMs));
    }
  } finally {
    await renderer?.close();
  }
}

// ── Weekly "still open?" check ─────────────

export type RecheckResult = { checked: number; closed: number; open: number; unknown: number };

type UndatedJob = { id: number; apply_url: string; apply_host: string; dated: boolean };

/**
 * "closed", "open", or "unknown" (blocked, unreachable, server error: the listing is left alone).
 * For a job with a closing date only hard signals count (the page is gone, or the recruitment
 * system marks it inactive): wording on the page that sounds closed is not enough to hide it early.
 */
async function liveness(job: UndatedJob, cache: Map<string, RobotsRules>): Promise<"open" | "closed" | "unknown"> {
  const system = systemApiUrl(job.apply_url);
  if (system) {
    if (!(await allowed(system.api, cache))) return "unknown";
    const res = await get(system.api, "application/json");
    if (res.status === 404 || res.status === 410) { await res.body?.cancel().catch(() => {}); return "closed"; }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return "unknown"; }
    try {
      return systemSaysClosed(system.via, JSON.parse(await readCapped(res, S.maxBytes))) ? "closed" : "open";
    } catch {
      return "unknown";
    }
  }
  if (!(await allowed(job.apply_url, cache))) return "unknown";
  const res = await get(job.apply_url, "text/html,application/xhtml+xml");
  if (res.status === 404 || res.status === 410) { await res.body?.cancel().catch(() => {}); return "closed"; }
  if (!res.ok || !/html|xml/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel().catch(() => {}); return "unknown"; }
  const html = await readCapped(res, S.maxBytes);
  return !job.dated && pageSaysClosed(html) ? "closed" : "open";
}

/**
 * Open jobs not checked in the last `recheckDays`: is the employer's page still there? Jobs
 * without a closing date, and jobs whose closing date is more than a few days off (an employer
 * can take a vacancy down early). Closed ones are hidden at once (status 'archived', as for
 * undated jobs the feed stopped carrying); anything uncertain is left as it is.
 */
export async function recheckUndatedJobs(opts: { limit?: number; budgetMs?: number } = {}): Promise<RecheckResult> {
  const r: RecheckResult = { checked: 0, closed: 0, open: 0, unknown: 0 };
  if (!S.enabled || process.env.VITEST) return r;
  const started = Date.now();
  const budget = opts.budgetMs ?? 4 * 60_000;
  const due = await sql<UndatedJob[]>`
    select id::int as id, apply_url, apply_host, deadline is not null as dated from jobs
     where status = 'active' and not is_demo
       and (deadline is null or deadline > now() + interval '3 days')
       and first_seen_at < now() - interval '2 days'
       and (live_checked_at is null or live_checked_at < now() - make_interval(days => ${S.recheckDays}))
     order by live_checked_at nulls first, first_seen_at
     limit ${opts.limit ?? S.recheckPerRun}`;
  const byHost = new Map<string, UndatedJob[]>();
  for (const j of due) {
    if (isListingSite(j.apply_host) || /\.pdf(?:$|[?#])/i.test(j.apply_url)) continue;
    const host = (() => { try { return new URL(j.apply_url).host; } catch { return j.apply_host; } })();
    byHost.set(host, [...(byHost.get(host) ?? []), j]);
  }
  const hosts = [...byHost.keys()];
  const robots = new Map<string, RobotsRules>();
  async function worker() {
    for (let host = hosts.shift(); host !== undefined; host = hosts.shift()) {
      for (const job of byHost.get(host)!) {
        if (Date.now() - started > budget) return;
        r.checked++;
        let state: "open" | "closed" | "unknown" = "unknown";
        try { state = await liveness(job, robots); } catch { state = "unknown"; }
        r[state]++;
        await sql`
          update jobs set live_checked_at = now(), live_result = ${state},
            status = case when ${state} = 'closed' and status = 'active' then 'archived' else status end,
            updated_at = case when ${state} = 'closed' then now() else updated_at end
          where id = ${job.id}`;
        await new Promise((res) => setTimeout(res, S.perHostDelayMs));
      }
    }
  }
  await Promise.all(Array.from({ length: S.concurrency }, worker));
  return r;
}
