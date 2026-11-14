/**
 * The same vacancy imported more than once: from the employer's own feed and again from a job
 * board that re-posted it (with a slightly different text, place or no closing date, so the
 * import's fingerprint didn't match). One copy stays listed: the one from the employer's own feed,
 * then one with a closing date, then the oldest. The others are taken down as duplicates; a closing
 * date only a removed copy had moves to the one kept.
 *
 * Two open listings are the same vacancy when they have the same employer and
 *   - the same vacancy number (the listing's own, a requisition id or the number in its link:
 *     "/job/38070" and "/requisitions/job/38070"), with places that don't contradict; or
 *   - the same title (letters only: no years, numbers, grade codes or accents), places that don't
 *     contradict (same country, or one has none), closing dates that don't contradict (the same,
 *     one missing, or a day apart), and either the same application link, or one came from the
 *     employer's own feed and the other from a job board (when the employer lists one vacancy of
 *     that title), or one only links to a general careers page or a guide: a copy that tells the
 *     visitor nothing the other doesn't.
 * Several posts an employer lists itself under one title ("E T Consultant" at the World Bank, each
 * with its own link) are left alone.
 */
import { sql } from "@/lib/db";
import { isGeneralCareersPage } from "@/lib/apply-link";
import { isListingSite } from "./url";
import { isGuideLink } from "./employer-link";

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

/**
 * Title words only: no accents, punctuation, numbers or grade codes ("Short Term Internship 2027 – Legal"
 * is "short term internship legal"; "Education Officer, (NO-1), Chilpancingo" is "education officer chilpancingo";
 * "… for 3.5 months" and "… for . months", the same title read twice, agree).
 */
const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(?:no|nob|p|d|g|gs|ns|sb|fs|ics|lica|iica|npsa|ipsa)[ -]?\d+[a-z]?\b/g, " ")
  .replace(/[^a-z]+/g, " ")
  // A duration whose number a copy lost ("…, LACRO/3 años" and "…, LACRO", "8 months" and "months").
  .replace(/\b(?:anos|meses|mois|jours|dias|semanas|days?|weeks?|months?|years?)\b/g, " ")
  .replace(/\s+/g, " ").trim();
/** An application link without scheme, "www.", fragment, tracking parameters or trailing slash (its query kept: "?job=123" tells vacancies apart). */
const linkKey = (u: string | null) => {
  if (!u) return null;
  try {
    const x = new URL(u);
    // A site's home or general careers page names no vacancy: two copies sharing it are not the same post.
    if (x.pathname.replace(/\/+$/, "") === "" || isGeneralCareersPage(u) || isGuideLink(u)) return null;
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|gclid|fbclid|source|src|promotion)/i.test(k)) x.searchParams.delete(k);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};
/** One link is the recruitment site the other's posting sits under ("…/sites/CX_1001" and "…/sites/CX_1001/job/24080"). */
const withinSite = (a: string | null, b: string | null) => {
  const [x, y] = [linkKey(a), linkKey(b)];
  return Boolean(x && y && (x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
};
/**
 * Two links of the same kind on the same recruitment site with different vacancy numbers
 * ("…/job/Phnom-Srok/…_JR53993" and "…/job/Kralanh/…_JR53869"): separate vacancies, whatever else
 * the copies share. Links of different kinds (UNICEF's "/jobs/…-00138514-…" and "/cw/en-us/job/596992")
 * number vacancies differently, so they don't tell.
 */
const distinctPosts = (a: DedupeRow, b: DedupeRow) => {
  const shape = (u: string | null) => {
    try { const x = new URL(u ?? ""); return `${x.hostname.replace(/^www\./, "")}/${x.pathname.split("/").filter(Boolean).slice(0, 2).join("/")}`.toLowerCase(); } catch { return null; }
  };
  const [sa, sb] = [shape(a.apply_url), shape(b.apply_url)];
  if (!sa || sa !== sb) return false;
  const [ra, rb] = [linkRefs(a), linkRefs(b)];
  return ra.length > 0 && rb.length > 0 && !ra.some((x) => rb.includes(x));
};
/** A title long enough to name one vacancy ("Education Officer, Chilpancingo, Guerrero"), not a common post ("E T Consultant", "Agronomist"). */
const specific = (t: string) => norm(t).split(" ").filter((w) => w.length > 1).length >= 4;
/** A copy with neither a closing date nor a place: nothing in it tells it apart from a fuller copy. */
const bare = (r: DedupeRow) => r.deadline === null && r.country_code === null;
const fits = <T,>(a: T | null, b: T | null) => a === null || b === null || a === b;
/** Closing dates that agree: the same, one missing, or a day apart (the same date read in two time zones). */
const datesFit = (a: string | null, b: string | null) => a === null || b === null || Math.abs(Date.parse(a) - Date.parse(b)) <= 86_400_000;
/**
 * The employer's vacancy numbers for a listing: its own reference, the requisition id in a
 * recruitment-system link ("…_JR128362"), and the number the link ends with or passes as the job
 * ("/job/38070", "…-596957-sweden", "?job=2604422"; five digits or more, so never a year).
 */
/** The vacancy numbers in a listing's link only (see refsOf). */
const linkRefs = (r: DedupeRow): string[] => refsOf({ ...r, reference: null, title: "" });
const refsOf = (r: DedupeRow): string[] => {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const k = (v ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (k.length >= 4 && /\d/.test(k)) out.add(k);
  };
  add(r.reference);
  // A number the employer put in the title ("…, 11 months, 596974"): UNICEF's vacancy number.
  add(r.title.match(/(?:^|[\s,(#])(\d{6,8})(?=[\s,)]|$)/)?.[1]);
  const u = r.apply_url ?? "";
  add(u.match(/[/_-](JR-?\d{4,}|REQ-?\d{4,}|R-?\d{5,})(?=[/?#_-]|$)/i)?.[1]);
  try {
    const x = new URL(u);
    add(x.pathname.match(/(?:^|\D)(\d{5,})(?=\D*$)/)?.[1]);
    for (const k of ["job", "jobid", "jobId", "id", "req", "vacancy"]) add(x.searchParams.get(k)?.match(/^\d{5,}$/)?.[0]);
  } catch { /* not a link */ }
  return [...out];
};

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
  const generic = (r: DedupeRow) => (!r.apply_url || isGeneralCareersPage(r.apply_url, r.title) || isGuideLink(r.apply_url) ? 1 : 0);
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
    if (r.organization_id === null) continue;
    // The employer's number, and the number in a link on the same recruitment site (two employers
    // sharing one site, UNDP and UNV, still mean one vacancy by one number there).
    const host = (() => { try { return new URL(r.apply_url ?? "").hostname.replace(/^www\./, ""); } catch { return null; } })();
    const keys = [
      ...refsOf(r).map((ref) => `${r.organization_id}|${ref}`),
      ...(host ? linkRefs(r).map((ref) => `@${host}|${ref}`) : []),
    ];
    // The same number: the same vacancy even when the copies' closing dates differ (the employer's copy's date is kept).
    const kept = keys.map((k) => byRef.get(k)).find((k) => k && fits(k.country_code, r.country_code));
    if (kept) {
      out.set(r.id, kept.id);
      if (!kept.deadline && r.deadline) kept.deadline = r.deadline;
      if (!kept.country_code && r.country_code) kept.country_code = r.country_code;
    } else {
      const copy = { ...r };
      for (const k of keys) if (!byRef.has(k)) byRef.set(k, copy);
    }
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
        !distinctPosts(k, r) && fits(k.country_code, r.country_code) && datesFit(k.deadline, r.deadline) &&
        ((linkKey(k.apply_url) !== null && linkKey(k.apply_url) === linkKey(r.apply_url)) ||
         (ownCopies === 1 && fromBoard(k) !== fromBoard(r)) ||
         // A copy that links only to a careers page or a guide adds nothing to one with the same title.
         linkKey(r.apply_url) === null || linkKey(k.apply_url) === null || withinSite(k.apply_url, r.apply_url) ||
         // A long, specific title: a bare copy (no closing date, no place) of a fuller one, or two copies
         // with the same closing date and country (one vacancy read from two of the employer's feeds).
         (specific(r.title) && (bare(r) || bare(k) || (r.deadline !== null && r.deadline === k.deadline && r.country_code !== null && r.country_code === k.country_code)))));
      if (same) {
        out.set(r.id, same.id);
        // The kept copy takes the closing date and place the other one had (it is checked against the next copies too).
        if (!same.deadline && r.deadline) same.deadline = r.deadline;
        if (!same.country_code && r.country_code) same.country_code = r.country_code;
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
    // The kept listing takes what only the removed copy had: its closing date, place and grade.
    await sql`update jobs k set deadline = coalesce(k.deadline, d.deadline),
        country_code = case when k.country_code is null and coalesce(k.city, '') = '' and coalesce(k.location_text, '') = '' then d.country_code else k.country_code end,
        city = case when k.country_code is null and coalesce(k.city, '') = '' and coalesce(k.location_text, '') = '' then d.city else k.city end,
        location_text = case when k.country_code is null and coalesce(k.city, '') = '' and coalesce(k.location_text, '') = '' then d.location_text else k.location_text end,
        grade = coalesce(k.grade, d.grade), updated_at = now()
      from jobs d where d.id = ${id} and k.id = ${of}`;
    await sql`update jobs set status = 'removed', removed_reason = ${`Same vacancy as #${of}`}, updated_at = now() where id = ${id} and status = 'active'`;
  }
  return taken;
}
