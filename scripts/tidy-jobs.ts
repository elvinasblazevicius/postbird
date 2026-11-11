/**
 * One-off tidy of jobs already on the site with the import's current rules: the title clean-up
 * (PDF names, post codes, capitalised runs, the organization's name in the title) and the
 * organization, when a job has none and its link, ATS address or title names a known one.
 * The job's address (slug) is kept, so links already shared keep working.
 * Usage: npm run tidy-jobs [-- --dry-run]   (or the "tidy-jobs" option of the GitHub workflow)
 */
import { getSql } from "../src/lib/db";
import { knownOrgByAtsPath, knownOrgByHost, knownOrgByName, knownOrgFromTitle, toOrgRef } from "../src/lib/feeds/extract";
import { upsertOrganizations } from "../src/lib/feeds/sync";
import { cleanTitle, stripOrgFromTitle } from "../src/lib/feeds/title";
import type { NormalizedJob } from "../src/lib/feeds/extract";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const sql = getSql();
  const jobs = await sql<{ id: number; title: string; apply_url: string | null; apply_host: string | null; org_name: string | null; org_short: string | null }[]>`
    select j.id, j.title, j.apply_url, j.apply_host, o.name as org_name, o.short_name as org_short
      from jobs j left join organizations o on o.id = j.organization_id
     where j.status = 'active'`;

  const changes: { id: number; title: string; orgSlug: string | null; before: string; org: string | null }[] = [];
  const newOrgs: Pick<NormalizedJob, "organization">[] = [];
  for (const j of jobs) {
    const found = j.org_name
      ? undefined
      : knownOrgByHost(j.apply_host ?? "") ?? knownOrgByAtsPath(j.apply_url ?? "") ?? knownOrgFromTitle(j.title);
    const orgRef = found ? toOrgRef(found.name) : null;
    const orgName = j.org_name ?? orgRef?.name ?? null;
    const known = orgName ? knownOrgByName(orgName) : undefined;
    const names = [orgName, j.org_short, orgRef?.short, ...(known?.aliases ?? [])];
    const title = orgName ? stripOrgFromTitle(cleanTitle(j.title), names) : cleanTitle(j.title);
    if (title !== j.title || orgRef) {
      changes.push({ id: j.id, title, orgSlug: orgRef?.slug ?? null, before: j.title, org: orgRef?.name ?? null });
      if (orgRef) newOrgs.push({ organization: orgRef });
    }
  }

  for (const c of changes) console.log(`#${c.id}: "${c.before}" → "${c.title}"${c.org ? ` [organization: ${c.org}]` : ""}`);
  console.log(`${jobs.length} open jobs, ${changes.length} to tidy${dryRun ? " (dry run, nothing written)" : ""}`);
  if (dryRun || !changes.length) return;

  const orgIds = await upsertOrganizations(newOrgs as NormalizedJob[]);
  for (const c of changes) {
    const orgId = c.orgSlug ? orgIds.get(c.orgSlug) ?? null : null;
    await sql`update jobs set title = ${c.title},
      organization_id = coalesce(organization_id, ${orgId}), updated_at = now() where id = ${c.id}`;
  }
  console.log(`Tidied ${changes.length} jobs.`);
}

main()
  .then(() => getSql().end({ timeout: 2 }))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await getSql().end({ timeout: 2 });
    process.exit(1);
  });
