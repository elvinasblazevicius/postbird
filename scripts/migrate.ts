/** Applies db/migrations/*.sql in order. Usage: npm run db:migrate */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getSql } from "../src/lib/db";

async function main() {
  const sql = getSql();
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await sql.unsafe("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  for (const f of files) {
    const name = f.replace(/\.sql$/, "");
    if (done.has(name)) { console.log(`✓ ${name} (already applied)`); continue; }
    await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    await sql`insert into schema_migrations (name) values (${name}) on conflict do nothing`;
    console.log(`✓ ${name} applied`);
  }
  await sql.end();
}

main().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
