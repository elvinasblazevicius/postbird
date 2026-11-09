/**
 * Re-assigns the category of open listings from their titles, using the current keywords in
 * src/config/categories.ts. The scheduled sync does this by itself for every listing still in its
 * feed; this catches the rest at once. Categories an admin picked by hand are never changed.
 *   npm run reclassify            show what would change
 *   npm run reclassify -- --apply change it
 */
import { getSql } from "../src/lib/db";
import { detectCategory } from "../src/lib/feeds/extract";

async function main() {
  const sql = getSql();
  const apply = process.argv.includes("--apply");
  const rows = await sql<{ id: number; title: string; category: string }[]>`
    select id::int as id, title, category from jobs where status = 'active' and not category_locked`;
  const changes = rows.map((r) => ({ ...r, next: detectCategory(r.title) })).filter((r) => r.next !== r.category);
  const moves = new Map<string, number>();
  for (const c of changes) moves.set(`${c.category} → ${c.next}`, (moves.get(`${c.category} → ${c.next}`) ?? 0) + 1);
  for (const [k, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
  console.log(`${changes.length} of ${rows.length} open listings would change category.`);
  if (apply && changes.length) {
    for (const c of changes) await sql`update jobs set category = ${c.next}, updated_at = now() where id = ${c.id} and not category_locked`;
    console.log("Applied.");
  } else if (changes.length) {
    console.log("Run again with --apply to change them.");
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error("Reclassify failed:", (e as Error).message);
  await getSql().end();
  process.exit(1);
});
