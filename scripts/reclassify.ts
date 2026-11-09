/**
 * Re-reads open listings with the current rules:
 *  - the category, from the title (keywords in src/config/categories.ts); categories an admin
 *    picked by hand are never changed;
 *  - the required and desirable languages, from the stored description (only listings that have
 *    one: the others are re-read by the next feed sync while they are still in their feed).
 * The scheduled sync does both by itself for every listing still in its feed; this catches the rest at once.
 *   npm run reclassify            show what would change
 *   npm run reclassify -- --apply change it
 */
import { getSql } from "../src/lib/db";
import { detectCategory, detectLanguageRequirements } from "../src/lib/feeds/extract";
import { htmlToText } from "../src/lib/text";

const same = (a: string[] | null, b: string[] | null) => (a ?? []).join() === (b ?? []).join();

async function main() {
  const sql = getSql();
  const apply = process.argv.includes("--apply");
  const rows = await sql<{ id: number; title: string; category: string; category_locked: boolean; description_html: string | null; languages: string[] | null; desirable_languages: string[] | null }[]>`
    select id::int as id, title, category, category_locked, description_html, languages, desirable_languages from jobs where status = 'active'`;

  const changes = rows.filter((r) => !r.category_locked).map((r) => ({ ...r, next: detectCategory(r.title) })).filter((r) => r.next !== r.category);
  const moves = new Map<string, number>();
  for (const c of changes) moves.set(`${c.category} → ${c.next}`, (moves.get(`${c.category} → ${c.next}`) ?? 0) + 1);
  for (const [k, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
  console.log(`${changes.length} of ${rows.length} open listings would change category.`);

  const withText = rows.filter((r) => r.description_html);
  const langChanges = withText
    .map((r) => ({ id: r.id, before: r, next: detectLanguageRequirements(htmlToText(r.description_html!)) }))
    .filter((c) => !same(c.before.languages, c.next.required) || !same(c.before.desirable_languages, c.next.desirable));
  console.log(`${langChanges.length} of ${withText.length} open listings with a stored description would change languages.`);

  if (apply && (changes.length || langChanges.length)) {
    for (const c of changes) await sql`update jobs set category = ${c.next}, updated_at = now() where id = ${c.id} and not category_locked`;
    for (const c of langChanges) {
      await sql`update jobs set languages = ${c.next.required}, desirable_languages = ${c.next.desirable}, updated_at = now() where id = ${c.id}`;
    }
    console.log("Applied.");
  } else if (changes.length || langChanges.length) {
    console.log("Run again with --apply to change them.");
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error("Reclassify failed:", (e as Error).message);
  await getSql().end();
  process.exit(1);
});
