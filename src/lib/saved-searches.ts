/**
 * Saved searches for paid email alerts. A saved search is the query string of
 * a /jobs URL (e.g. "q=data&region=africa"); "" means every new vacancy.
 */
import { categoryBySlug } from "@/config/categories";
import { countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, regionBySlug } from "@/config/regions";
import { sql, type Db } from "@/lib/db";
import { getOrganization, jobsUrl, parseFilters } from "@/lib/jobs";

export const MAX_SAVED_SEARCHES = 5;

/** Same character rule as the sign-up forms (a URL-encoded query string). */
const SEARCH_RE = /^[\w%=&+.,~-]*$/;

/**
 * Turns a query string (or a pasted /jobs link) into the canonical saved
 * form: only valid filters, in a fixed order, without paging, sorting or the
 * "posted within" filter (alerts always look at what is new since the last email).
 * Returns null when the value isn't a usable search.
 */
export function normalizeSearch(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.length > 600) return null;
  // A pasted link: keep only its query string, and only if it's a /jobs link.
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) {
    try {
      const u = new URL(s, "https://example.invalid");
      if (u.pathname.replace(/\/+$/, "") !== "/jobs") return null;
      s = u.search.replace(/^\?/, "");
    } catch {
      return null;
    }
  } else {
    s = s.replace(/^\?/, "");
  }
  if (s.length > 400 || !SEARCH_RE.test(s)) return null;
  const f = parseFilters(Object.fromEntries(new URLSearchParams(s)));
  return jobsUrl({ ...f, page: undefined, sort: undefined, posted: undefined }).replace(/^\/jobs\??/, "");
}

/** Filters of a saved search that the alert sign-up's "What should we watch for?" step carries over unchanged. */
const STEP_KEEP = ["category", "grade", "type", "remote", "lang", "exp", "orgtype", "closing", "hidelocal"] as const;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The saved search for the alert sign-up pages (/alerts, /pricing/trial): from the "What should we
 * watch for?" step (keywords, organization, location, plus the filters it carried over) when it was
 * just submitted, otherwise from ?search= (a search started on the jobs page). null = none.
 */
export function searchFromAlertStep(sp: SP): string | null {
  if (one(sp.step) === "watch") {
    const p = new URLSearchParams();
    for (const k of ["q", "org", "where", ...STEP_KEEP]) {
      const v = one(sp[k]).trim().slice(0, 120);
      if (v) p.set(k, v);
    }
    return normalizeSearch(p.toString()) || null;
  }
  const raw = one(sp.search);
  return raw && raw.length <= 400 ? normalizeSearch(raw) || null : null;
}

/** The parts of a saved search the step's fields don't show, as hidden form fields. */
export function alertStepKeep(search: string | null): Record<string, string> {
  if (!search) return {};
  const p = new URLSearchParams(search);
  return Object.fromEntries(STEP_KEEP.filter((k) => p.get(k)).map((k) => [k, p.get(k)!]));
}

/** Plain-language summary of a saved search, e.g. "Data & Analytics jobs, in Africa, grade P-3". */
export async function describeSearch(query: string): Promise<string | null> {
  const f = parseFilters(Object.fromEntries(new URLSearchParams(query)));
  const parts: string[] = [];
  if (f.q) parts.push(`“${f.q}”`);
  if (f.category) parts.push(`${categoryBySlug(f.category)?.name} jobs`);
  if (f.org) parts.push(`at ${(await getOrganization(f.org).catch(() => null))?.name ?? f.org}`);
  if (f.country) parts.push(`in ${countryBySlug(f.country)?.name}`);
  if (f.region) parts.push(`in ${regionBySlug(f.region)?.name}`);
  if (f.remote) parts.push("remote / home-based");
  if (f.grade) parts.push(`grade ${GRADE_GROUPS.find((g) => g.value === f.grade)?.name ?? f.grade}`);
  if (f.type) parts.push(f.type.toLowerCase());
  if (f.lang) parts.push(`${f.lang} required`);
  if (f.closing) parts.push(`closing within ${f.closing} days`);
  if (f.hidelocal) parts.push("without local-only posts");
  return parts.length ? parts.join(", ") : null;
}

export type SavedSearch = { id: number; search: string; label: string | null; created_at: Date; last_sent_at: Date | null };

export async function listSavedSearches(subscriberId: number): Promise<SavedSearch[]> {
  return sql<SavedSearch[]>`
    select id::int as id, search, label, created_at, last_sent_at from saved_searches
    where subscriber_id = ${subscriberId} order by created_at, id`;
}

export type AddSearchResult = { ok: true; added: boolean } | { ok: false; error: string };

/**
 * Adds a saved search (already normalized). Adding one that exists is not an
 * error. The 5-per-subscriber limit is enforced by the database as well.
 * db: a transaction to run in (the Paddle webhook), otherwise the pool.
 */
export async function addSavedSearch(subscriberId: number, search: string, db: Db = sql): Promise<AddSearchResult> {
  // Checked first: the limit trigger runs before "on conflict", so a duplicate would hit the limit message.
  const [dupe] = await db`select 1 from saved_searches where subscriber_id = ${subscriberId} and search = ${search}`;
  if (dupe) return { ok: true, added: false };
  const label = (await describeSearch(search)) ?? "All new vacancies";
  try {
    const rows = await db`
      insert into saved_searches (subscriber_id, search, label) values (${subscriberId}, ${search}, ${label})
      on conflict (subscriber_id, search) do nothing returning id`;
    return { ok: true, added: rows.length === 1 };
  } catch (e) {
    if ((e as { code?: string }).code === "P0001") return { ok: false, error: `You can save up to ${MAX_SAVED_SEARCHES} searches. Remove one first.` };
    throw e;
  }
}

export async function removeSavedSearch(subscriberId: number, id: number): Promise<boolean> {
  const rows = await sql`delete from saved_searches where id = ${id} and subscriber_id = ${subscriberId} returning id`;
  return rows.length === 1;
}
