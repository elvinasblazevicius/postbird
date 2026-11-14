/**
 * The same vacancy imported more than once: from the employer's own feed and again from a job
 * board that re-posted it (with a slightly different text, place or no closing date, so the
 * import's fingerprint didn't match). One copy stays listed: the one from the employer's own feed,
 * then one with a closing date, then the oldest. The others are taken down as duplicates; a closing
 * date only a removed copy had moves to the one kept.
 *
 * Two open listings are the same vacancy when they have the same employer, the same title (letters
 * and digits only, any case), places that don't contradict (same country, or one has none),
 * closing dates that don't contradict (the same, or one has none), and either the same application
 * link or one came from the employer's own feed and the other from a job board. Several posts an employer lists itself under one
 * title ("E T Consultant" at the World Bank, each with its own link) are left alone.
 */
import { sql } from "@/lib/db";
import { isGeneralCareersPage } from "@/lib/apply-link";
import { isListingSite } from "./url";

export type DedupeRow = {
  id: number;
  organization_id: number | null;
  title: string;
  country_code: string | null;
  deadline: string | null;
  apply_url: string | null;
  source_host: string | null;
  /** The employer's vacancy number, when the listing gives one. */
  reference?: string | null;
};

/** Title words only: no accents, punctuation or years ("Short Term Internship 2027 – Legal" is "short term internship legal"). */
const norm = (t: string) => t.replace(/\b(?:19|20)\d\d\b/g, " ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** An application link without scheme, "www.", fragment, tracking parameters or trailing slash (its query kept: "?job=123" tells vacancies apart). */
const linkKey = (u: string | null) => {
  if (!u) return null;
  try {
    const x = new URL(u);
    // A site's home or general careers page names no vacancy: two copies sharing it are not the same post.
    if (x.pathname.replace(/\/+$/, "") === "" || isGeneralCareersPage(u)) return null;
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|gclid|fbclid|source|src|promotion)/i.test(k)) x.searchParams.delete(k);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};
const fits = <T,>(a: T | null, b: T | null) => a === null || b === null || a === b;
/** Closing dates that agree: the same, one missing, or a day apart (the same date read in two time zones). */
const datesFit = (a: string | null, b: string | null) => a === null || b === null || Math.abs(Date.parse(a) - Date.parse(b)) <= 86_400_000;
/** The employer's vacancy number: the listing's own, or the requisition id in a recruitment-system link ("…_JR128362"). */
const refOf = (r: DedupeRow) =>
  (r.reference ?? r.apply_url?.match(/[/_-](JR-?\d{4,}|REQ-?\d{4,}|R-?\d{5,})(?=[/?#_-]|$)/i)?.[1] ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();

/** For each duplicate, the listing it repeats (exported for the tests). */
export function findDuplicates(rows: DedupeRow[]): Map<number, number> {
  const groups = new Map<string, DedupeRow[]>();
  for (const r of rows) {
    if (r.organization_id === null) continue;
    const k = `${r.organization_id}|${norm(r.title)}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const fromBoard = (r: DedupeRow) => isListingSite(r.source_host);
  // Employer's own copy first, then one whose link opens the posting (not a careers home page), then dated, then oldest.
  const generic = (r: DedupeRow) => (!r.apply_url || isGeneralCareersPage(r.apply_url, r.title) ? 1 : 0);
  const rank = (r: DedupeRow) => [fromBoard(r) ? 1 : 0, generic(r), r.deadline ? 0 : 1, r.id];
  const before = (a: DedupeRow, b: DedupeRow) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  const out = new Map<number, number>();
  // The same vacancy number at the same employer is the same vacancy, whatever the two titles say
  // ("UNITAID Team Lead (Communications)" and "Team Lead (Communications)", reference 2601234).
  const byRef = new Map<string, DedupeRow>();
  for (const r of [...rows].sort(before)) {
    const ref = refOf(r);
    if (r.organization_id === null || ref.length < 4 || !/\d/.test(ref)) continue;
    const k = `${r.organization_id}|${ref}`;
    const kept = byRef.get(k);
    // The same number: the same vacancy even when the copies' closing dates differ (the employer's copy's date is kept).
    if (kept && fits(kept.country_code, r.country_code)) {
      out.set(r.id, kept.id);
      if (!kept.deadline && r.deadline) kept.deadline = r.deadline;
    } else if (!kept) byRef.set(k, { ...r });
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // A job board's copy is matched to the employer's own listing by title only when the employer
    // lists one vacancy of that title; when it lists several ("E T Consultant"), only the same link counts.
    const ownCopies = g.filter((r) => !fromBoard(r)).length;
    const kept: DedupeRow[] = [];
    for (const r of [...g].sort(before)) {
      if (out.has(r.id)) continue;
      const same = kept.find((k) =>
        fits(k.country_code, r.country_code) && datesFit(k.deadline, r.deadline) &&
        ((linkKey(k.apply_url) !== null && linkKey(k.apply_url) === linkKey(r.apply_url)) || (ownCopies === 1 && fromBoard(k) !== fromBoard(r))));
      if (same) {
        out.set(r.id, same.id);
        // The kept copy takes the closing date the other one had (it is checked against the next copies too).
        if (!same.deadline && r.deadline) same.deadline = r.deadline;
      } else kept.push({ ...r });
    }
  }
  return out;
}

/**
 * Takes down the duplicates among open listings; returns how many. Listings taken down as
 * duplicates before are checked again with them, and listed again when they no longer count as
 * one (a rule made stricter, the other copy closed).
 */
export async function removeDuplicateListings(): Promise<number> {
  const rows = await sql<(DedupeRow & { status: string })[]>`
    select id::int, organization_id::int, title, country_code, deadline::text, apply_url, source_host, reference, status
      from jobs
     where not is_demo and organization_id is not null
       and (status = 'active' or (status = 'removed' and removed_reason like 'Same vacancy as #%'
            and (deadline is null or deadline >= (now() at time zone 'utc')::date)))`;
  const dups = findDuplicates(rows);
  const back = rows.filter((r) => r.status === "removed" && !dups.has(r.id)).map((r) => r.id);
  if (back.length) await sql`update jobs set status = 'active', removed_reason = null, updated_at = now() where id = any(${back})`;
  let taken = 0;
  for (const [id, of] of dups) {
    if (rows.find((r) => r.id === id)?.status !== "active") {
      await sql`update jobs set removed_reason = ${`Same vacancy as #${of}`} where id = ${id}`;
      continue;
    }
    taken++;
    await sql`update jobs set deadline = coalesce(deadline, (select d.deadline from jobs d where d.id = ${id})), updated_at = now() where id = ${of}`;
    await sql`update jobs set status = 'removed', removed_reason = ${`Same vacancy as #${of}`}, updated_at = now() where id = ${id} and status = 'active'`;
  }
  return taken;
}
