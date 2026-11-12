/**
 * Missing vacancy details read by an AI model (DeepSeek) from the vacancy page's text, for fields
 * the rules couldn't fill. Nothing is taken on trust: the model must quote the exact words it read
 * each value from, and a value is kept only when that quote is really in the page text and the
 * value passes the same checks as the rules (a plausible closing date, a known country). The
 * model never sees anything but the page text, and nothing here writes to the database.
 */
import { plausibleDeadline } from "./vacancy-page";
import { findCountries } from "./extract";

export type AiField<T> = { value: T | null; quote: string | null };
export type AiFacts = {
  closingDate: AiField<string>;
  country: AiField<string>;
  organization: AiField<string>;
  contractType: AiField<string>;
  grade: AiField<string>;
};
export type CheckedFacts = {
  deadline: string | null;
  countryCode: string | null;
  organization: string | null;
  contractType: string | null;
  grade: string | null;
  /** Values the model gave that failed the checks, with the reason (for the trial report). */
  rejected: string[];
};

const PROMPT = `You read job vacancy pages for a job board. From the page text, extract only what the page states explicitly:
- closing_date: the application deadline, as YYYY-MM-DD
- country: the duty station's country (in English)
- organization: the hiring organization's name
- contract_type: one of "Fixed-term", "Temporary", "Consultancy", "Internship", "Volunteer", "Fellowship", "Traineeship"
- grade: the post's grade as written (e.g. P-3, NO-B, G-5, FS-4)
For each field return {"value": ..., "quote": ...} where quote is the exact words from the page (copied character for character, 3 to 120 characters) that state it. If the page doesn't state a field, return {"value": null, "quote": null}. Never guess, infer or use outside knowledge.
Answer with one JSON object with exactly these keys: closing_date, country, organization, contract_type, grade.`;

const CONTRACT_TYPES = ["Fixed-term", "Temporary", "Consultancy", "Internship", "Volunteer", "Fellowship", "Traineeship"];

/** Lower case, single spaces, straight quotes: how a quote is compared with the page text. */
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Asks DeepSeek for the details; null when no key is set. `usage`: tokens in and out (for the cost). */
export async function askDeepSeek(title: string, pageText: string): Promise<{ facts: AiFacts; usage: { input: number; output: number } } | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: `Vacancy title: ${title}\n\nPage text:\n${pageText.slice(0, 12_000)}` },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const raw = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Record<string, { value?: unknown; quote?: unknown } | undefined>;
  const field = (k: string): AiField<string> => {
    const v = raw[k];
    return { value: typeof v?.value === "string" && v.value.trim() ? v.value.trim() : null, quote: typeof v?.quote === "string" && v.quote.trim() ? v.quote.trim() : null };
  };
  return {
    facts: { closingDate: field("closing_date"), country: field("country"), organization: field("organization"), contractType: field("contract_type"), grade: field("grade") },
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
  };
}

/** Keeps only the values whose quote is in the page text and that pass the checks. */
export function checkFacts(f: AiFacts, pageText: string, today = new Date()): CheckedFacts {
  const page = norm(pageText);
  const out: CheckedFacts = { deadline: null, countryCode: null, organization: null, contractType: null, grade: null, rejected: [] };
  const quoted = (name: string, x: AiField<string>): string | null => {
    if (!x.value) return null;
    if (!x.quote || x.quote.length < 3 || !page.includes(norm(x.quote))) { out.rejected.push(`${name}: quote not on the page`); return null; }
    return x.value;
  };
  const d = quoted("closing date", f.closingDate);
  if (d) {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) ? plausibleDeadline(d, today) : null;
    if (ok) out.deadline = ok; else out.rejected.push(`closing date: ${d} not plausible`);
  }
  const c = quoted("country", f.country);
  if (c) {
    const codes = findCountries(c);
    if (codes.length === 1) out.countryCode = codes[0]; else out.rejected.push(`country: "${c}" not one known country`);
  }
  const o = quoted("organization", f.organization);
  if (o) out.organization = o.slice(0, 120);
  const t = quoted("contract type", f.contractType);
  if (t) {
    if (CONTRACT_TYPES.includes(t)) out.contractType = t; else out.rejected.push(`contract type: "${t}" not a known type`);
  }
  const g = quoted("grade", f.grade);
  if (g) {
    if (/^[A-Z]{1,4}-?\d{1,2}$|^NO-?[A-E]$|^[DP]-?\d$/i.test(g)) out.grade = g.toUpperCase(); else out.rejected.push(`grade: "${g}" not a grade`);
  }
  return out;
}
