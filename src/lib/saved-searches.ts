/**
 * Saved searches for email alerts. A saved search is the query string of a
 * /jobs URL (e.g. "q=data&region=africa"); "" means every new vacancy.
 * Paid alerts use up to MAX_SAVED_SEARCHES; the free weekly email uses one.
 */
import { categoryBySlug } from "@/config/categories";
import { ORG_TYPES } from "@/config/regions";
import { isLiveStatus } from "@/lib/billing/statuses";
import { sql, type Db } from "@/lib/db";
import { orList, placeNames, STATED_DETAIL } from "@/lib/filter-labels";
import { gradeLabel } from "@/lib/grades";
import { derivedFilters, EXPERIENCE_BANDS, filtersFromQuery, getOrganizations, jobsUrl } from "@/lib/jobs";

export const MAX_SAVED_SEARCHES = 20;
/** Saved searches without a plan: the one the free weekly email uses. */
export const FREE_SAVED_SEARCHES = 1;

/**
 * How many saved searches a subscriber with this billing status may keep: up to MAX_SAVED_SEARCHES
 * with a plan (LIVE_STATUSES; same rule as the database trigger, migration 026).
 */
export function searchLimit(billingStatus: string): number {
  return isLiveStatus(billingStatus) ? MAX_SAVED_SEARCHES : FREE_SAVED_SEARCHES;
}

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
  // Repeated filters (grade=P-3&grade=P-4) are kept, in a fixed order (see parseFilters).
  const f = filtersFromQuery(s);
  return jobsUrl({ ...f, page: undefined, sort: undefined, posted: undefined }).replace(/^\/jobs\??/, "");
}

/** Filters of a saved search that the alert sign-up's "What should we watch for?" step carries over unchanged. */
const STEP_KEEP = ["category", "grade", "type", "remote", "lang", "exp", "orgtype", "closing", "hidelocal", "unstated"] as const;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Every value of a field that may be repeated (where, grade, org), at most 10. */
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).slice(0, 10);
/** Filters that may hold several values. */
const MULTI = new Set(["where", "grade", "org"]);

/**
 * The saved search for the alert sign-up pages (/alerts, /pricing/trial): from the "What should we
 * watch for?" step (keywords, organization, location, plus the filters it carried over) when it was
 * just submitted, otherwise from ?search= (a search started on the jobs page). null = none.
 */
export function searchFromAlertStep(sp: SP): string | null {
  if (one(sp.step) === "watch") {
    const p = new URLSearchParams();
    for (const k of ["q", "org", "where", ...STEP_KEEP]) {
      for (const raw of MULTI.has(k) ? all(sp[k]) : [one(sp[k])]) {
        const v = raw.trim().slice(0, 120);
        if (v) p.append(k, v);
      }
    }
    return normalizeSearch(p.toString()) || null;
  }
  const raw = one(sp.search);
  return raw && raw.length <= 400 ? normalizeSearch(raw) || null : null;
}

/** The "What should we watch for?" fields inside the alert sign-up form. */
export const WATCH_FIELDS = { q: "watch_q", org: "watch_org", where: "watch_where" } as const;

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[]; has(name: string): boolean };

/**
 * The saved search an alert sign-up form sends: its `search` field (a search started on the jobs
 * page, or ""), with the form's own "What should we watch for?" fields (WATCH_FIELDS) in place of
 * that search's keywords, organization and location when the form has those fields. Other filters
 * of the search (category, grade…) are kept. "" means every new vacancy.
 */
export function searchFromSignupForm(form: FormLike): string {
  const raw = String(form.get("search") ?? "");
  const p = new URLSearchParams(raw.length <= 400 && SEARCH_RE.test(raw) ? raw : "");
  if (Object.values(WATCH_FIELDS).some((k) => form.has(k))) {
    for (const k of ["q", "org", "where", "country", "region"]) p.delete(k);
    for (const [key, field] of Object.entries(WATCH_FIELDS)) {
      // The location and the organization may each be several (one field each).
      for (const raw of key === "where" || key === "org" ? form.getAll(field).slice(0, 10) : [form.get(field)]) {
        const v = String(raw ?? "").trim().slice(0, 120);
        if (v) p.append(key, v);
      }
    }
  }
  return normalizeSearch(p.toString()) ?? "";
}

/** The parts of a saved search the step's fields don't show, as hidden form fields (a repeated grade gives several). */
export function alertStepKeep(search: string | null): [string, string][] {
  if (!search) return [];
  const p = new URLSearchParams(search);
  return STEP_KEEP.flatMap((k) => p.getAll(k).filter(Boolean).map((v): [string, string] => [k, v]));
}

const POSTED: Record<string, string> = { "1": "posted in the last 24 hours", "7": "posted in the last 7 days", "30": "posted in the last 30 days" };
const ORG_TYPE_PHRASE: Record<string, string> = {
  un: "in the UN system",
  eu: "at EU institutions",
  ifi: "at development banks",
  io: "at other international organizations",
  ngo: "at NGOs",
};

/**
 * Plain-language summary of a saved search, naming every filter it carries, e.g.
 * "Data and analytics jobs, in Kenya or Uganda, grade P-3 or P-4, French mentioned".
 */
export async function describeSearch(query: string): Promise<string | null> {
  const f = filtersFromQuery(query);
  const parts: string[] = [];
  if (f.q) parts.push(`“${f.q}”`);
  if (f.category?.length) parts.push(`${orList(f.category.map((c) => categoryBySlug(c)?.name ?? c))} jobs`);
  if (f.org?.length) {
    const orgs = await getOrganizations(f.org).catch(() => []);
    parts.push(`at ${orList(f.org.map((s) => orgs.find((o) => o.slug === s)?.name ?? s))}`);
  }
  if (f.orgtype?.length) parts.push(f.orgtype.length === 1 ? ORG_TYPE_PHRASE[f.orgtype[0]] ?? `at ${ORG_TYPES.find((o) => o.value === f.orgtype![0])?.name ?? f.orgtype[0]}` : `at ${orList(f.orgtype.map((v) => ORG_TYPES.find((o) => o.value === v)?.name ?? v))}`);
  const places = placeNames(f);
  if (places.length) parts.push(`in ${orList(places)}`);
  if (f.remote) parts.push("remote / home-based");
  if (f.grade?.length) parts.push(`grade ${orList(f.grade.map(gradeLabel))}`);
  if (f.type?.length) parts.push(orList(f.type.map((t) => t.toLowerCase())));
  if (f.exp?.length) parts.push(`experience ${orList(f.exp.map((v) => EXPERIENCE_BANDS.find((b) => b.value === v)?.name.toLowerCase() ?? v))}`);
  if (f.lang?.length) parts.push(`${orList(f.lang)} mentioned`);
  if (f.posted) parts.push(POSTED[f.posted]);
  if (f.closing) parts.push(`closing within ${f.closing} days`);
  if (f.hidelocal) parts.push("without local-only posts");
  if (f.unstated) parts.push(`also those that don't state ${orList(derivedFilters(f).map((k) => STATED_DETAIL[k]))}`);
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
 * error. The limit (20 with a plan, 1 without) is enforced by the database
 * (trigger saved_searches_limit, migration 026).
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
    const err = e as { code?: string; hint?: string };
    if (err.code === "P0001") {
      return {
        ok: false,
        error: err.hint === "saved_searches_free_limit"
          ? `The free weekly email uses one search. Remove it to choose another, or start daily alerts for up to ${MAX_SAVED_SEARCHES} searches.`
          : `You can save up to ${MAX_SAVED_SEARCHES} searches. Remove one first.`,
      };
    }
    throw e;
  }
}

/**
 * The free weekly email's search: makes `search` the subscriber's only saved
 * search (keeping its last_sent_at when it was already saved). Used when a
 * free sign-up is confirmed. Run it inside a transaction.
 */
export async function replaceWithWeeklySearch(subscriberId: number, search: string, db: Db): Promise<void> {
  await db`delete from saved_searches where subscriber_id = ${subscriberId} and search <> ${search}`;
  const res = await addSavedSearch(subscriberId, search, db);
  if (!res.ok) throw new Error(res.error);
}

export async function removeSavedSearch(subscriberId: number, id: number): Promise<boolean> {
  const rows = await sql`delete from saved_searches where id = ${id} and subscriber_id = ${subscriberId} returning id`;
  return rows.length === 1;
}
