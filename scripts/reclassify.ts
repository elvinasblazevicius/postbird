/**
 * Re-reads open listings (still listed and not past their closing date) with the current rules:
 *  - the category, from the title (keywords in src/config/categories.ts); categories an admin
 *    picked by hand are never changed;
 *  - the required and desirable languages, from the stored description, or for listings without
 *    one from the stored summary (an excerpt: changed only when the summary names every language
 *    already stored, so a language the excerpt cut off is never dropped);
 *  - the country, from the stored location text and title (countryFromStoredPlace in
 *    src/lib/feeds/extract.ts, e.g. "New Caledonia (France)" is New Caledonia); changed only when
 *    the current rules name exactly one country and it differs, never cleared.
 * The scheduled sync does all of this by itself for every listing still in its feed; this catches the rest at once.
 *   npm run reclassify            show what would change (nothing is written)
 *   npm run reclassify -- --apply change it
 */
import { getSql } from "../src/lib/db";
import { countryFromStoredPlace, detectCategory, detectLanguageRequirements, type LanguageRequirements } from "../src/lib/feeds/extract";
import { htmlToText } from "../src/lib/text";

const same = (a: string[] | null, b: string[] | null) => (a ?? []).join() === (b ?? []).join();

type Row = {
  id: number; title: string; category: string; category_locked: boolean; description_html: string | null; summary: string | null;
  languages: string[] | null; desirable_languages: string[] | null; country_code: string | null; location_text: string | null;
};

/** Languages re-read from the summary, or null when the summary doesn't name every language already stored. */
export function languagesFromSummary(row: Pick<Row, "summary" | "languages" | "desirable_languages">): LanguageRequirements | null {
  if (!row.summary) return null;
  const next = detectLanguageRequirements(row.summary);
  const found = new Set([...(next.required ?? []), ...(next.desirable ?? [])]);
  const stored = [...(row.languages ?? []), ...(row.desirable_languages ?? [])];
  return stored.every((l) => found.has(l)) ? next : null;
}

async function main() {
  const sql = getSql();
  const apply = process.argv.includes("--apply");
  const rows = await sql<Row[]>`
    select id::int as id, title, category, category_locked, description_html, summary, languages, desirable_languages, country_code, location_text
    from jobs where status = 'active' and (deadline is null or deadline >= (now() at time zone 'utc')::date)`;

  const changes = rows.filter((r) => !r.category_locked).map((r) => ({ ...r, next: detectCategory(r.title) })).filter((r) => r.next !== r.category);
  const moves = new Map<string, number>();
  for (const c of changes) moves.set(`${c.category} → ${c.next}`, (moves.get(`${c.category} → ${c.next}`) ?? 0) + 1);
  for (const [k, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
  console.log(`${changes.length} of ${rows.length} open listings would change category.`);

  const langChanges = rows
    .map((r) => ({ id: r.id, before: r, next: r.description_html ? detectLanguageRequirements(htmlToText(r.description_html)) : languagesFromSummary(r) }))
    .filter((c): c is { id: number; before: Row; next: LanguageRequirements } => c.next !== null)
    .filter((c) => !same(c.before.languages, c.next.required) || !same(c.before.desirable_languages, c.next.desirable));
  const withText = rows.filter((r) => r.description_html || r.summary).length;
  console.log(`${langChanges.length} of ${withText} open listings with a stored description or summary would change languages.`);

  const countryChanges = rows
    .map((r) => ({ id: r.id, title: r.title, before: r.country_code, next: countryFromStoredPlace(r.title, r.location_text) }))
    .filter((c): c is { id: number; title: string; before: string | null; next: string } => c.next !== null && c.next !== c.before);
  for (const c of countryChanges.slice(0, 20)) console.log(`  #${c.id} ${c.before ?? "(none)"} → ${c.next}  ${c.title}`);
  console.log(`${countryChanges.length} of ${rows.length} open listings would change country.`);

  const any = changes.length || langChanges.length || countryChanges.length;
  if (apply && any) {
    for (const c of changes) await sql`update jobs set category = ${c.next}, updated_at = now() where id = ${c.id} and not category_locked`;
    for (const c of langChanges) {
      await sql`update jobs set languages = ${c.next.required}, desirable_languages = ${c.next.desirable}, updated_at = now() where id = ${c.id}`;
    }
    for (const c of countryChanges) await sql`update jobs set country_code = ${c.next}, updated_at = now() where id = ${c.id}`;
    console.log("Applied.");
  } else if (any) {
    console.log("Dry run: nothing was changed. Run again with --apply to change them.");
  }
  await sql.end();
}

// Only when run as a script (the tests import languagesFromSummary).
if (process.argv[1] && /reclassify\.ts$/.test(process.argv[1])) {
  main().catch(async (e) => {
    console.error("Reclassify failed:", (e as Error).message);
    await getSql().end();
    process.exit(1);
  });
}
