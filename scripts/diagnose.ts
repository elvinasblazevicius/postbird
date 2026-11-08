/**
 * Connection check: measures database round-trip time and whether many
 * parallel queries (as on the homepage) complete through the pooler.
 * Run with `npm run diagnose` (or the "diagnose" option of the GitHub workflow).
 */
import postgres from "postgres";

const url = (process.env.DATABASE_URL ?? "").trim().replace(/([?&])pgbouncer=[^&]*&?/i, "$1").replace(/[?&]$/, "");
if (!url) throw new Error("DATABASE_URL is not set");
const host = url.replace(/^.*@/, "").replace(/[/?].*$/, "");
console.log("Database host:", host);

async function timed<T>(label: string, fn: () => Promise<T>, limitMs = 20000): Promise<void> {
  const t = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer after ${limitMs / 1000}s`)), limitMs))]);
    console.log(`✓ ${label}: ${Date.now() - t} ms`);
  } catch (e) {
    console.log(`✗ ${label}: ${(e as Error).message} (${Date.now() - t} ms)`);
  }
}

async function main() {
for (const max of [3, 12]) {
  const sql = postgres(url, { prepare: false, max, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require", connect_timeout: 15, idle_timeout: 5, onnotice: () => {} });
  console.log(`\n— pool size ${max} —`);
  await timed("first query (includes connecting)", () => sql`select 1`);
  await timed("second query (round trip)", () => sql`select 1`);
  await timed("12 queries in parallel", () => Promise.all(Array.from({ length: 12 }, (_, i) => sql`select ${i}::int as n, count(*) from jobs`)));
  await timed("12 parallel queries with joins", () => Promise.all(Array.from({ length: 12 }, () =>
    sql`select o.slug, count(*)::int from jobs j join organizations o on o.id = j.organization_id where j.status = ${"active"} group by o.slug`)));
  await sql.end({ timeout: 2 }).catch(() => {});
}
}
main().then(() => process.exit(0));
