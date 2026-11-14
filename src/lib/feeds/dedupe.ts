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
import { isListingSite } from "./url";

export type DedupeRow = {
  id: number;
  organization_id: number | null;
  title: string;
  country_code: string | null;
  deadline: string | null;
  apply_url: string | null;
  source_host: string | null;
};

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const linkKey = (u: string | null) => (u ? u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "") : null);
const fits = <T,>(a: T | null, b: T | null) => a === null || b === null || a === b;

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
  // Employer's own copy first, then dated, then oldest.
  const rank = (r: DedupeRow) => [fromBoard(r) ? 1 : 0, r.deadline ? 0 : 1, r.id];
  const before = (a: DedupeRow, b: DedupeRow) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  const out = new Map<number, number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const kept: DedupeRow[] = [];
    for (const r of [...g].sort(before)) {
      const same = kept.find((k) =>
        fits(k.country_code, r.country_code) && fits(k.deadline, r.deadline) &&
        ((linkKey(k.apply_url) !== null && linkKey(k.apply_url) === linkKey(r.apply_url)) || fromBoard(k) !== fromBoard(r)));
      if (same) {
        out.set(r.id, same.id);
        // The kept copy takes the closing date the other one had (it is checked against the next copies too).
        if (!same.deadline && r.deadline) same.deadline = r.deadline;
      } else kept.push({ ...r });
    }
  }
  return out;
}

/** Takes down the duplicates among open listings; returns how many. */
export async function removeDuplicateListings(): Promise<number> {
  const rows = await sql<DedupeRow[]>`
    select id::int, organization_id::int, title, country_code, deadline::text, apply_url, source_host
      from jobs where status = 'active' and not is_demo and organization_id is not null`;
  const dups = findDuplicates(rows);
  for (const [id, of] of dups) {
    await sql`update jobs set deadline = coalesce(deadline, (select d.deadline from jobs d where d.id = ${id})), updated_at = now() where id = ${of}`;
    await sql`update jobs set status = 'removed', removed_reason = ${`Same vacancy as #${of}`}, updated_at = now() where id = ${id} and status = 'active'`;
  }
  return dups.size;
}
