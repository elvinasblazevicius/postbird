/**
 * Trial of the AI fill-in (src/lib/feeds/ai-extract.ts) on open vacancies with a missing closing
 * date, country or organization. READS ONLY: it fetches each vacancy page (respecting robots.txt),
 * asks DeepSeek, checks the answers, and prints what would be filled. Nothing is written.
 *   npm run ai-fill-trial            (AI_TRIAL_LIMIT=40 by default; needs DEEPSEEK_API_KEY)
 */
import { getSql } from "../src/lib/db";
import { allowed } from "../src/lib/feeds/enrich";
import type { RobotsRules } from "../src/lib/feeds/robots";
import { mainContentHtml } from "../src/lib/feeds/vacancy-page";
import { askDeepSeek, checkFacts } from "../src/lib/feeds/ai-extract";
import { htmlToText } from "../src/lib/text";

const LIMIT = Number(process.env.AI_TRIAL_LIMIT ?? 40);
// DeepSeek list prices per million tokens (cache miss), checked when writing; the run prints its own total.
const PRICE_IN = 0.27, PRICE_OUT = 1.1;

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) { console.error("::error::Add the DEEPSEEK_API_KEY repository secret."); process.exit(1); }
  const sql = getSql();
  const jobs = await sql<{ id: number; title: string; apply_url: string; deadline: string | null; country_code: string | null; location_text: string | null; org: string | null; job_type: string | null; grade: string | null }[]>`
    select j.id::int as id, j.title, j.apply_url, j.deadline::text as deadline, j.country_code, j.location_text, o.name as org, j.job_type, j.grade
      from jobs j left join organizations o on o.id = j.organization_id
     where j.status = 'active' and not j.is_demo and (j.deadline is null or j.country_code is null or j.organization_id is null)
     order by j.first_seen_at desc limit ${LIMIT}`;
  const robots = new Map<string, RobotsRules>();
  const t = { jobs: jobs.length, unreadable: 0, asked: 0, deadline: 0, country: 0, organization: 0, contractType: 0, grade: 0, rejected: 0, tokensIn: 0, tokensOut: 0 };
  for (const j of jobs) {
    let text = "";
    try {
      if (!(await allowed(j.apply_url, robots))) throw new Error("robots.txt");
      const res = await fetch(j.apply_url, { headers: { "user-agent": "PostbirdBot/1.0 (+https://postbird.nuevanova.com/about)", accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = htmlToText(mainContentHtml(await res.text()));
      if (text.length < 300) throw new Error("almost no text (page built with JavaScript?)");
    } catch (e) {
      t.unreadable++;
      console.log(`#${j.id} UNREADABLE (${(e as Error).message}) — ${j.title.slice(0, 70)}`);
      continue;
    }
    const ai = await askDeepSeek(j.title, text).catch((e: Error) => { console.log(`#${j.id} AI error: ${e.message}`); return null; });
    if (!ai) continue;
    t.asked++; t.tokensIn += ai.usage.input; t.tokensOut += ai.usage.output;
    const c = checkFacts(ai.facts, text);
    const fills: string[] = [];
    if (!j.deadline && c.deadline) { fills.push(`closing ${c.deadline}`); t.deadline++; }
    if (!j.country_code && c.countryCode) { fills.push(`country ${c.countryCode}`); t.country++; }
    if (!j.org && c.organization) { fills.push(`organization "${c.organization}"`); t.organization++; }
    if (!j.job_type && c.contractType) { fills.push(`type ${c.contractType}`); t.contractType++; }
    if (!j.grade && c.grade) { fills.push(`grade ${c.grade}`); t.grade++; }
    t.rejected += c.rejected.length;
    console.log(`#${j.id} ${fills.length ? `WOULD FILL ${fills.join(", ")}` : "nothing new"}${c.rejected.length ? ` | rejected: ${c.rejected.join("; ")}` : ""} — ${j.title.slice(0, 70)}`);
  }
  const cost = (t.tokensIn * PRICE_IN + t.tokensOut * PRICE_OUT) / 1e6;
  console.log("\nSummary:", JSON.stringify(t));
  console.log(`Estimated cost of this run: $${cost.toFixed(4)} (${t.asked} pages)`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
