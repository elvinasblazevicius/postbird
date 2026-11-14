/**
 * The import's current rules applied again to every open listing, on every scheduled import
 * (src/lib/feeds/sync.ts), so a rule added or improved later reaches the listings already on the site
 * without anyone running anything:
 *   - the title clean-up (codes, empty placeholders, the organization's name or a repeated place);
 *   - the employer, when a listing has none (or only an internal unit code) and its link, recruitment
 *     account or title names one; a known organization stored under a second spelling moves to its entry;
 *   - job-board text in descriptions (src/lib/board-text.ts);
 *   - grades in the import's form ("P4" → "P-4");
 *   - the place a listing's own description states, when it has none.
 * A listing's address (slug) never changes, so shared links keep working. `dryRun` reports only.
 */
import { sql } from "@/lib/db";
import { stripBoardText } from "@/lib/board-text";
import { factsFromPage } from "./vacancy-page";
import { isUnitCode, placeFromTitle, knownOrgByAtsPath, knownOrgByHost, knownOrgByName, knownOrgFromTitle, normalizeGrade, orgFromTitleAndLink, toOrgRef, withoutTrailingPlace } from "./extract";
import { cleanTitle, stripOrgFromTitle } from "./title";

export type TidyResult = { checked: number; titles: number; employers: number; descriptions: number; grades: number; places: number; lines: string[] };

export async function tidyListings({ dryRun = false }: { dryRun?: boolean } = {}): Promise<TidyResult> {
  const out: TidyResult = { checked: 0, titles: 0, employers: 0, descriptions: 0, grades: 0, places: 0, lines: [] };
  // Places first: a title's trailing place ("…, Maseru – Lesotho") is read before the title clean-up drops it.
  await tidyPlaces(out, dryRun);
  await tidyTitlesAndEmployers(out, dryRun);
  await tidyDescriptions(out, dryRun);
  await tidyGrades(out, dryRun);
  return out;
}

async function tidyTitlesAndEmployers(out: TidyResult, dryRun: boolean) {
  const jobs = await sql<{ id: number; title: string; apply_url: string | null; apply_host: string | null; org_name: string | null; org_short: string | null; org_slug: string | null }[]>`
    select j.id::int, j.title, j.apply_url, j.apply_host, o.name as org_name, o.short_name as org_short, o.slug as org_slug
      from jobs j left join organizations o on o.id = j.organization_id
     where j.status = 'active' and not j.is_demo`;
  out.checked = jobs.length;
  const orgSlugs = new Set((await sql<{ slug: string }[]>`select slug from organizations`).map((r) => r.slug));
  for (const j of jobs) {
    // A known organization stored twice under different spellings: the listing moves to the known
    // organization's entry, only when that entry exists (an organization stored once keeps its page).
    const canonical = j.org_name && knownOrgByName(j.org_name) ? toOrgRef(j.org_name) : null;
    const misfiled = Boolean(canonical && j.org_slug && canonical.slug !== j.org_slug && orgSlugs.has(canonical.slug));
    // An employer's internal unit stored as the organization ("AF_COD Democratic Republic of Congo"): found again, or none.
    const replace = misfiled || Boolean(j.org_name && isUnitCode(j.org_name));
    const current = replace ? null : j.org_name;
    const found = misfiled ? knownOrgByName(canonical!.name) : current
      ? undefined
      : knownOrgByHost(j.apply_host ?? "") ?? knownOrgByAtsPath(j.apply_url ?? "") ?? knownOrgFromTitle(j.title);
    const named = !found && !current ? orgFromTitleAndLink(j.title, j.apply_url) : null;
    const orgRef = found ? toOrgRef(found.name) : named ? toOrgRef(named) : null;
    const orgName = current ?? orgRef?.name ?? null;
    const known = orgName ? knownOrgByName(orgName) : undefined;
    const bracketed = orgName?.match(/\(([A-Z][A-Za-z0-9&-]{1,9})\)\s*$/)?.[1];
    const names = [orgName, j.org_short, orgRef?.short, known?.short, bracketed, ...(known?.aliases ?? [])];
    const title = withoutTrailingPlace(orgName ? stripOrgFromTitle(cleanTitle(j.title), names) : cleanTitle(j.title));
    const newOrg = orgRef && orgRef.slug !== j.org_slug ? orgRef : null;
    if (title === j.title && !newOrg && !replace) continue;
    if (title !== j.title) out.titles++;
    if (newOrg) out.employers++;
    out.lines.push(`#${j.id}: "${j.title}" → "${title}"${newOrg ? ` [organization: ${newOrg.name}]` : ""}`);
    if (dryRun) continue;
    let orgId: number | null = null;
    if (newOrg) {
      await sql`insert into organizations (slug, name, short_name, org_type, website)
        values (${newOrg.slug}, ${newOrg.name}, ${newOrg.short}, ${newOrg.type}, ${newOrg.website}) on conflict (slug) do nothing`;
      const [o] = await sql<{ id: number }[]>`select id::int from organizations where slug = ${newOrg.slug}`;
      orgId = o?.id ?? null;
    }
    await sql`update jobs set title = ${title},
      organization_id = ${replace ? sql`${orgId}` : sql`coalesce(organization_id, ${orgId})`}, updated_at = now() where id = ${j.id}`;
  }
}

async function tidyDescriptions(out: TidyResult, dryRun: boolean) {
  const rows = await sql<{ id: number; description_html: string }[]>`
    select id::int, description_html from jobs where status = 'active' and description_html is not null
       and description_html ~* '(unjobnet|untalent|impactpool|unjobs[.]org|reliefweb|email.{0,10}protected|no longer open|show advice for this position)'`;
  for (const r of rows) {
    const clean = stripBoardText(r.description_html);
    if (clean === r.description_html) continue;
    out.descriptions++;
    if (!dryRun) await sql`update jobs set description_html = ${clean || null}, updated_at = now() where id = ${r.id}`;
  }
}

async function tidyGrades(out: TidyResult, dryRun: boolean) {
  const rows = await sql<{ id: number; grade: string }[]>`select id::int, grade from jobs where status = 'active' and grade is not null`;
  for (const r of rows) {
    const g = normalizeGrade(r.grade);
    if (g === r.grade) continue;
    out.grades++;
    out.lines.push(`#${r.id}: grade "${r.grade}" → "${g}"`);
    if (!dryRun) await sql`update jobs set grade = ${g}, updated_at = now() where id = ${r.id}`;
  }
}

async function tidyPlaces(out: TidyResult, dryRun: boolean) {
  const rows = await sql<{ id: number; title: string; apply_url: string | null; description_html: string | null }[]>`
    select id::int, title, apply_url, description_html from jobs
     where status = 'active' and not is_demo and country_code is null and coalesce(city, '') = '' and coalesce(location_text, '') = ''
       and coalesce(is_remote, false) = false`;
  for (const r of rows) {
    // The description's labelled place ("Duty station: …"), else the place the title ends with.
    const fromText = r.description_html ? factsFromPage(r.title, r.apply_url ?? "", r.description_html) : null;
    const f = fromText && (fromText.countryCode || fromText.locationText) ? fromText : placeFromTitle(r.title);
    if (!f || (!f.countryCode && !f.locationText)) continue;
    out.places++;
    out.lines.push(`#${r.id}: place "${[f.city, f.countryCode, f.locationText].filter(Boolean).join(" | ")}"`);
    if (!dryRun) await sql`update jobs set country_code = ${f.countryCode ?? null}, city = ${f.city ?? null}, location_text = ${f.locationText ?? null}, updated_at = now() where id = ${r.id}`;
  }
}
