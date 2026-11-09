/**
 * Applies db/migrations/*.sql in order. Usage: npm run db:migrate
 *
 * Each file runs in ONE transaction together with its schema_migrations row,
 * so a migration that fails half-way leaves nothing behind and is applied
 * again in full on the next run. Every transaction first takes a
 * transaction-level advisory lock (pg_advisory_xact_lock), so two migrators
 * started at the same time (e.g. two deploys) apply each file once, one after
 * the other: the second waits, then sees the file as applied. A transaction-level
 * lock also works through Supabase's transaction pooler, where a session-level
 * lock would not. Migration files must therefore not use statements that
 * can't run inside a transaction (CREATE INDEX CONCURRENTLY, VACUUM, ...);
 * 001–009 don't.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getSql } from "../src/lib/db";

/** Advisory lock key for migrations (any constant bigint; only this script uses it). */
const MIGRATION_LOCK = 4_812_309_117;

async function main() {
  const sql = getSql();
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx.unsafe("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  });
  for (const f of files) {
    const name = f.replace(/\.sql$/, "");
    const applied = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
      // Checked under the lock: another migrator may have applied it while this one waited.
      const [done] = await tx`select 1 from schema_migrations where name = ${name}`;
      if (done) return false;
      await tx.unsafe(readFileSync(path.join(dir, f), "utf8"));
      await tx`insert into schema_migrations (name) values (${name}) on conflict do nothing`;
      return true;
    });
    console.log(applied ? `✓ ${name} applied` : `✓ ${name} (already applied)`);
  }
  await sql.end();
}

main().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
