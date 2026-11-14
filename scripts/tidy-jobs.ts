/**
 * One-off tidy of jobs already on the site with the import's current rules: the title clean-up
 * (PDF names, post codes, capitalised runs, the organization's name or a repeated place in the title) and the
 * organization, when a job has none and its link, ATS address or title names a known one.
 * The job's address (slug) is kept, so links already shared keep working.
 * Usage: npm run tidy-jobs [-- --dry-run]   (or the "tidy-jobs" option of the GitHub workflow)
 */
import { getSql } from "../src/lib/db";
import { stripBoardText } from "../src/lib/board-text";
import { isUnitCode, normalizeGrade, knownOrgByAtsPath, knownOrgByHost, knownOrgByName, knownOrgFromTitle, toOrgRef, withoutTrailingPlace } from "../src/lib/feeds/extract";
import { upsertOrganizations } from "../src/lib/feeds/sync";
import { cleanTitle, stripOrgFromTitle } from "../src/lib/feeds/title";
import type { NormalizedJob } from "../src/lib/feeds/extract";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const sql = getSql();
  const jobs = await sql<{ id: number; title: string; apply_url: string | null; apply_host: string | null; org_name: string | null; org_short: string | null; org_slug: string | null }[]>`
    select j.id, j.title, j.apply_url, j.apply_host, o.name as org_name, o.short_name as org_short, o.slug as org_slug
      from jobs j left join organizations o on o.id = j.organization_id
     where j.status = 'active'`;

  const orgSlugs = new Set((await sql<{ slug: string }[]>`select slug from organizations`).map((r) => r.slug));
  const changes: { id: number; title: string; orgSlug: string | null; before: string; org: string | null; unit: boolean }[] = [];
  const newOrgs: Pick<NormalizedJob, "organization">[] = [];
  for (const j of jobs) {
    // An employer's internal unit stored as the organization ("AF_COD Democratic Republic of Congo"): found again from the link or title, or none.
    // A known organization stored twice under different spellings ("IUCN" and "International Union for
    // Conservation of Nature (IUCN)"): the listing moves to the known organization's one entry.
    const canonical = j.org_name && knownOrgByName(j.org_name) ? toOrgRef(j.org_name) : null;
    // Only when that entry already exists: an organization stored once under another address keeps it (its page's links stay).
    const misfiled = Boolean(canonical && j.org_slug && canonical.slug !== j.org_slug && orgSlugs.has(canonical.slug));
    const unit = misfiled || Boolean(j.org_name && isUnitCode(j.org_name));
    if (unit) j.org_name = null;
    const found = misfiled ? knownOrgByName(canonical!.name) : j.org_name
      ? undefined
      : knownOrgByHost(j.apply_host ?? "") ?? knownOrgByAtsPath(j.apply_url ?? "") ?? knownOrgFromTitle(j.title);
    const orgRef = found ? toOrgRef(found.name) : null;
    const orgName = j.org_name ?? orgRef?.name ?? null;
    const known = orgName ? knownOrgByName(orgName) : undefined;
    const bracketed = orgName?.match(/\(([A-Z][A-Za-z0-9&-]{1,9})\)\s*$/)?.[1];
    const names = [orgName, j.org_short, orgRef?.short, known?.short, bracketed, ...(known?.aliases ?? [])];
    const title = withoutTrailingPlace(orgName ? stripOrgFromTitle(cleanTitle(j.title), names) : cleanTitle(j.title));
    if (title !== j.title || orgRef || unit) {
      changes.push({ id: j.id, title, orgSlug: orgRef?.slug ?? null, before: j.title, org: orgRef?.name ?? null, unit });
      if (orgRef) newOrgs.push({ organization: orgRef });
    }
  }

  for (const c of changes) console.log(`#${c.id}: "${c.before}" → "${c.title}"${c.org ? ` [organization: ${c.org}]` : ""}${c.unit ? " [organization corrected]" : ""}`);
  console.log(`${jobs.length} open jobs, ${changes.length} to tidy${dryRun ? " (dry run, nothing written)" : ""}`);
  if (dryRun || !changes.length) return;

  const orgIds = await upsertOrganizations(newOrgs as NormalizedJob[]);
  for (const c of changes) {
    const orgId = c.orgSlug ? orgIds.get(c.orgSlug) ?? null : null;
    await sql`update jobs set title = ${c.title},
      organization_id = ${c.unit ? sql`${orgId}` : sql`coalesce(organization_id, ${orgId})`}, updated_at = now() where id = ${c.id}`;
  }
  console.log(`Tidied ${changes.length} jobs.`);
}

/** Descriptions with a job board's words in them (src/lib/board-text.ts), stored without them. */
async function tidyDescriptions() {
  const sql = getSql();
  const rows = await sql<{ id: number; description_html: string }[]>`
    select id::int, description_html from jobs where status = 'active' and description_html is not null
       and description_html ~* '(unjobnet|untalent|impactpool|unjobs\.org|reliefweb|email.{0,10}protected|no longer open|show advice for this position)'`;
  let changed = 0;
  for (const r of rows) {
    const clean = stripBoardText(r.description_html);
    if (clean === r.description_html) continue;
    changed++;
    if (!dryRun) await sql`update jobs set description_html = ${clean || null}, updated_at = now() where id = ${r.id}`;
  }
  console.log(`${rows.length} descriptions with job-board text, ${changed} ${dryRun ? "to clean (dry run)" : "cleaned"}.`);
}

/** Grades stored as written ("P4", "LICA 9", "A6 - A6"), in the import's form ("P-4", "LICA-9", "A6"). */
async function tidyGrades() {
  const sql = getSql();
  const rows = await sql<{ id: number; grade: string }[]>`select id::int, grade from jobs where status = 'active' and grade is not null`;
  const changes = rows.map((r) => ({ id: r.id, from: r.grade, to: normalizeGrade(r.grade) })).filter((c) => c.to !== c.from);
  for (const c of changes) {
    console.log(`#${c.id}: grade "${c.from}" → "${c.to}"`);
    if (!dryRun) await sql`update jobs set grade = ${c.to}, updated_at = now() where id = ${c.id}`;
  }
  console.log(`${changes.length} grades ${dryRun ? "to normalize (dry run)" : "normalized"}.`);
}

main()
  .then(() => tidyDescriptions())
  .then(() => tidyGrades())
  .then(() => getSql().end({ timeout: 2 }))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await getSql().end({ timeout: 2 });
    process.exit(1);
  });
