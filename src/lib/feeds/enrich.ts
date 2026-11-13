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
import { countryByCode } from "@/config/countries";
import { htmlToText } from "@/lib/text";
import { EMPTY_FACTS, factsFromPage, factsFromSystem, hasFacts, mainContentHtml, pageSaysClosed, plausibleDeadline, systemApiUrl, systemSaysClosed, type PageFacts } from "./vacancy-page";

const S = IMPORT_SETTINGS.vacancyPages;

export type EnrichResult = {
  checked: number; withFacts: number; nothing: number; blocked: number; errors: number; skipped: number;
  /** Pages built in the browser that were read with a headless browser (of them, how many gave facts). */
  rendered: number; renderedWithFacts: number;
  /** Pages the AI read for details the rules missed; values it filled; its token use. */
  ai: { asked: number; filled: number; rejected: number; tokensIn: number; tokensOut: number; why: Record<string, number> };
  filled: { deadline: number; place: number; jobType: number; grade: number; experience: number; languages: number };
  via: Record<string, number>;
};

type DueJob = {
  id: number; title: string; apply_url: string; apply_host: string;
  deadline: string | null; country_code: string | null; location_text: string | null; job_type: string | null;
  grade: string | null; min_experience_years: number | null; languages: string[] | null; page_attempts: number;
  description_html: string | null; ai_checked_at: Date | null;
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
 * Details the rules left empty (closing date, place, contract type, grade), read by the AI from the
 * vacancy's text and kept only when they pass checkFacts (the quote must be in the text). `text` is
 * the employer's page, or the feed's own text when the page can't be read. Once per job
 * (ai_checked_at), at most `S.aiPerRun` jobs per run, and only with DEEPSEEK_API_KEY set. `now`
 * false: not yet (an unreachable page may come back on a later try).
 */
async function withAi(job: DueJob, facts: PageFacts | null, text: string | null, r: EnrichResult, now = true): Promise<PageFacts | null> {
  if (!now || !text || text.length < 300 || !process.env.DEEPSEEK_API_KEY || job.ai_checked_at || r.ai.asked >= S.aiPerRun) return facts;
  const f: PageFacts = facts ?? { ...EMPTY_FACTS, via: "text" };
  const needDate = !job.deadline && !f.deadline;
  const needPlace = !job.country_code && !job.location_text && !f.countryCode && !f.locationText;
  const needType = !job.job_type && !f.jobType;
  const needGrade = !job.grade && !f.grade;
  if (!needDate && !needPlace && !needType && !needGrade) return facts;
  try {
    const ai = await askDeepSeek(job.title, text);
    if (!ai) return facts;
    await sql`update jobs set ai_checked_at = now() where id = ${job.id}`;
    r.ai.asked++; r.ai.tokensIn += ai.usage.input; r.ai.tokensOut += ai.usage.output;
    const c = checkFacts(ai.facts, text);
    r.ai.rejected += c.rejected.length;
    // "country: quote not on the page" → counted under that reason, without the value.
    for (const why of c.rejected) { const k = why.replace(/"[^"]*"|\d{4}-\d{2}-\d{2}/g, "…"); r.ai.why[k] = (r.ai.why[k] ?? 0) + 1; }
    const out: PageFacts = { ...f };
    if (needDate && c.deadline) { out.deadline = c.deadline; r.ai.filled++; }
    if (needPlace && c.countryCode) {
      out.countryCode = c.countryCode;
      if (c.city) { out.city = c.city; out.locationText = `${c.city}, ${countryByCode(c.countryCode)?.name ?? c.countryCode}`; }
      r.ai.filled++;
    }
    if (needType && c.contractType) { out.jobType = c.contractType; r.ai.filled++; }
    if (needGrade && c.grade) { out.grade = c.grade; r.ai.filled++; }
    return out;
  } catch {
    return facts; // the AI being down never stops the import
  }
}

/** The feed's own text for a job whose page can't be read. */
function feedTextOf(job: DueJob): string | null {
  const t = htmlToText(job.description_html ?? "").trim();
  return t.length >= 300 ? t.slice(0, 20_000) : null;
}

/** The page's main text as kept for search and the AI (migration 028): plain text, at most 20,000 characters. */
function pageTextOf(html: string | null): string | null {
  if (!html) return null;
  const t = htmlToText(mainContentHtml(html)).slice(0, 20_000).trim();
  return t.length >= 200 ? t : null;
}

async function save(job: DueJob, result: string, f: PageFacts | null, r: EnrichResult, text: string | null = null): Promise<void> {
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
      page_text = coalesce(${text}, page_text),
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
  const r: EnrichResult = { checked: 0, withFacts: 0, nothing: 0, blocked: 0, errors: 0, skipped: 0, rendered: 0, renderedWithFacts: 0, ai: { asked: 0, filled: 0, rejected: 0, tokensIn: 0, tokensOut: 0, why: {} }, filled: { deadline: 0, place: 0, jobType: 0, grade: 0, experience: 0, languages: 0 }, via: {} };
  // Tests never visit real websites (the readers have their own unit tests).
  if (!S.enabled || process.env.VITEST) return r;
  const started = Date.now();
  const budget = opts.budgetMs ?? S.budgetMs;
  const due = await sql<DueJob[]>`
    select id::int as id, title, apply_url, apply_host, deadline::text as deadline, country_code, location_text, job_type, grade, min_experience_years, languages, page_attempts, description_html, ai_checked_at
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
          const facts = await withAi(job, read.facts, pageTextOf(read.html) ?? feedTextOf(job), r);
          if (facts && hasFacts(facts)) {
            r.withFacts++;
            r.via[facts.via] = (r.via[facts.via] ?? 0) + 1;
            await save(job, "ok", facts, r, pageTextOf(read.html));
          } else {
            r.nothing++;
            await save(job, "none", null, r, pageTextOf(read.html));
          }
        } catch (e) {
          if (e instanceof BuiltByScript) builtByScript.push(job); // read with a browser below
          // The page can't be read: the AI reads the feed's own text instead (closed to robots: now;
          // unreachable: on the last try, as the page may come back).
          else if (e instanceof BlockedByRobots) { r.blocked++; await save(job, "blocked", await withAi(job, null, feedTextOf(job), r), r); }
          else { r.errors++; await save(job, "error", await withAi(job, null, feedTextOf(job), r, job.page_attempts + 1 >= S.maxAttempts), r); }
        }
        await new Promise((res) => setTimeout(res, S.perHostDelayMs));
      }
    }
  }
  await Promise.all(Array.from({ length: S.concurrency }, worker));
  await readBuiltByScript(builtByScript, Date.now(), S.browserBudgetMs, r);
  await aiFillGaps(r);
  return r;
}

/** Pages whose text arrives through JavaScript: one headless browser, one page at a time. */
async function readBuiltByScript(jobs: DueJob[], started: number, budget: number, r: EnrichResult): Promise<void> {
  if (!jobs.length) return;
  const renderer = Date.now() - started < budget ? await openRenderer() : null;
  try {
    for (const job of jobs) {
      const html = renderer && Date.now() - started < budget ? await renderer.render(job.apply_url) : null;
      const facts = await withAi(job, html ? factsFromPage(job.title, job.apply_url, html) : null, pageTextOf(html) ?? feedTextOf(job), r);
      if (html) r.rendered++;
      if (facts && hasFacts(facts)) {
        r.withFacts++;
        if (html) r.renderedWithFacts++;
        r.via[facts.via] = (r.via[facts.via] ?? 0) + 1;
        await save(job, "ok", facts, r, pageTextOf(html));
      } else {
        r.nothing++;
        await save(job, "none", null, r, pageTextOf(html));
      }
      if (renderer) await new Promise((res) => setTimeout(res, S.perHostDelayMs));
    }
  } finally {
    await renderer?.close();
  }
}

/**
 * Open vacancies whose page has been read (or couldn't be) and that still lack a closing date, a
 * place, a contract type or a grade: the AI reads their kept text once (the employer's page text,
 * else the feed's description; nothing is fetched). Only empty fields are filled, and the values
 * are also kept as page facts so a later re-import doesn't drop them (withPageFacts in sync.ts).
 */
async function aiFillGaps(r: EnrichResult): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) return;
  const room = S.aiPerRun - r.ai.asked;
  if (room <= 0) return;
  const jobs = await sql<(DueJob & { page_text: string | null })[]>`
    select id::int as id, title, apply_url, apply_host, deadline::text as deadline, country_code, location_text, job_type, grade,
           min_experience_years, languages, page_attempts, description_html, ai_checked_at, page_text
      from jobs
     where status = 'active' and not is_demo and ai_checked_at is null and page_checked_at is not null
       and (deadline is null or (country_code is null and location_text is null) or job_type is null or grade is null)
     order by first_seen_at desc
     limit ${room}`;
  const started = Date.now();
  const queue = [...jobs];
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() - started > S.aiBudgetMs) return;
      const f = await withAi(job, null, job.page_text ?? feedTextOf(job), r);
      if (!f) continue;
      const deadline = plausibleDeadline(f.deadline);
      const place = !job.country_code && !job.location_text && f.countryCode;
      await sql`
        update jobs set
          page_deadline = coalesce(page_deadline, ${deadline}), deadline = coalesce(deadline, ${deadline}),
          page_country_code = coalesce(page_country_code, ${place ? f.countryCode : null}), page_city = coalesce(page_city, ${place ? f.city : null}),
          page_location_text = coalesce(page_location_text, ${place ? f.locationText : null}),
          country_code = case when country_code is null and location_text is null then ${place ? f.countryCode : null} else country_code end,
          city = case when country_code is null and location_text is null then ${place ? f.city : null} else city end,
          location_text = case when country_code is null and location_text is null then ${place ? f.locationText : null} else location_text end,
          page_job_type = coalesce(page_job_type, ${f.jobType}), job_type = coalesce(job_type, ${f.jobType}),
          page_grade = coalesce(page_grade, ${f.grade}), grade = coalesce(grade, ${f.grade}),
          updated_at = now()
        where id = ${job.id}`;
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
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
