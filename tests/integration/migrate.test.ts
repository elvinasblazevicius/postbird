/**
 * The migration script against a real database whose statement_timeout (as set on a database
 * role in production, README "Database time limits") is shorter than a migration takes: each
 * migration transaction turns the limit off for itself, so the migration still applies.
 * Runs scripts/migrate.ts in a child process from a temporary folder holding one slow migration.
 * Runs only with TEST_DATABASE_URL pointing at a THROWAWAY database (its default settings are
 * changed for the duration of the test, then reset).
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;
const ROOT = path.join(__dirname, "..", "..");
const PROBE = "000_statement_timeout_probe";

describe.skipIf(!TEST_DB)("migrations and a role or database statement_timeout (database)", () => {
  let sql: postgres.Sql;
  let dir: string;

  const setTimeoutFor = (value: string | null) => sql.unsafe(`do $$ begin execute format('alter database %I ${value === null ? "reset statement_timeout" : `set statement_timeout = ${value}`}', current_database()); end $$`);

  beforeAll(async () => {
    sql = postgres(TEST_DB!, { max: 1, onnotice: () => {} });
    dir = mkdtempSync(path.join(tmpdir(), "pb-migrate-"));
    mkdirSync(path.join(dir, "db", "migrations"), { recursive: true });
    // Longer than the limit below; harmless anywhere else.
    writeFileSync(path.join(dir, "db", "migrations", `${PROBE}.sql`), "select pg_sleep(0.5);\ncreate table if not exists migrate_timeout_probe (x int);\n");
  });

  afterAll(async () => {
    await setTimeoutFor(null).catch(() => {});
    await sql`delete from schema_migrations where name = ${PROBE}`.catch(() => {});
    await sql`drop table if exists migrate_timeout_probe`.catch(() => {});
    await sql.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a migration longer than the database's statement_timeout still applies", async () => {
    await setTimeoutFor("200");
    try {
      // The limit is real: a new session can't run the migration's statement on its own.
      const plain = postgres(TEST_DB!, { max: 1, onnotice: () => {} });
      await expect(plain`select pg_sleep(0.5)`).rejects.toThrow(/statement timeout/);
      await plain.end();

      const run = await promisify(execFile)(path.join(ROOT, "node_modules", ".bin", "tsx"), [path.join(ROOT, "scripts", "migrate.ts")], {
        cwd: dir, // the script reads db/migrations from the working folder
        env: { ...process.env, DATABASE_URL: TEST_DB },
        timeout: 60_000,
      });
      expect(run.stdout).toContain(`✓ ${PROBE} applied`);
    } finally {
      await setTimeoutFor(null);
    }
    expect(await sql`select 1 from schema_migrations where name = ${PROBE}`).toHaveLength(1);
    expect(await sql`select to_regclass('migrate_timeout_probe') is not null as ok`).toEqual([{ ok: true }]);
  }, 60_000);
});
