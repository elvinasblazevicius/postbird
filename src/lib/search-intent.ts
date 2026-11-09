/**
 * Reading what people mean when they type a search: "un jobs in kenya",
 * "remote internship", "eu vacancies". Known words become filters and the
 * rest is matched against titles, organizations and descriptions.
 */
import { COUNTRIES } from "@/config/countries";

export type SearchIntent = {
  /** Words left to match as text (null when nothing is left). */
  text: string | null;
  orgtype?: string;
  remote?: boolean;
  type?: string;
  country?: string;
};

const STOP_WORDS = new Set([
  "job", "jobs", "vacancy", "vacancies", "position", "positions", "post", "posts", "career", "careers", "opening", "openings",
  "opportunity", "opportunities", "role", "roles", "work", "employment", "hiring", "in", "at", "for", "with", "the", "a", "an", "of", "and",
]);

/** Phrases that pick an organization type. Longest first. */
const ORG_TYPE_PHRASES: [string, string][] = [
  ["united nations", "un"],
  ["un system", "un"],
  ["european union", "eu"],
  ["eu institutions", "eu"],
  ["un", "un"],
  ["eu", "eu"],
  ["ngo", "ngo"],
  ["ngos", "ngo"],
];

const REMOTE_WORDS = new Set(["remote", "home-based", "homebased", "telecommute", "telework"]);
const INTERNSHIP_WORDS = new Set(["intern", "interns", "internship", "internships"]);
const CONSULTANCY_WORDS = new Set(["consultancy", "consultancies", "consultant", "consultants"]);
const VOLUNTEER_WORDS = new Set(["volunteer", "volunteers", "volunteering"]);

const COUNTRY_NAMES: [string, string][] = COUNTRIES.flatMap((c) =>
  [c.name, ...c.aliases].map((n) => [n.toLowerCase(), c.slug] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

const wordRe = (phrase: string) => new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`);

export function interpretQuery(q: string | undefined | null): SearchIntent {
  if (!q) return { text: null };
  let s = ` ${q.toLowerCase().replace(/[“”"',;:!?()]/g, " ").replace(/\s+/g, " ").trim()} `;
  const intent: SearchIntent = { text: null };

  for (const [phrase, value] of ORG_TYPE_PHRASES) {
    const re = wordRe(phrase);
    if (re.test(s)) {
      intent.orgtype ??= value;
      s = s.replace(re, " ");
    }
  }
  for (const [name, slug] of COUNTRY_NAMES) {
    if (name.length < 4) continue; // avoid short aliases matching ordinary words
    const re = wordRe(name);
    if (re.test(s)) {
      intent.country ??= slug;
      s = s.replace(re, " ");
      break;
    }
  }

  const words = s.split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const w of words) {
    if (REMOTE_WORDS.has(w)) intent.remote = true;
    else if (INTERNSHIP_WORDS.has(w)) intent.type = "Internship";
    else if (CONSULTANCY_WORDS.has(w)) intent.type ??= "Consultancy";
    else if (VOLUNTEER_WORDS.has(w)) intent.type ??= "Volunteer";
    else if (!STOP_WORDS.has(w)) kept.push(w);
  }
  intent.text = kept.length ? kept.join(" ") : null;
  return intent;
}

/** Postgres regex for a word (or the start of one, for longer words) as a whole token. */
export function wordPattern(term: string): string {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return term.length <= 4 ? `\\m${esc}\\M` : `\\m${esc}`;
}
