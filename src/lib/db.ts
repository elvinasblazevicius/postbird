import postgres, { type ISql, type TransactionSql } from "postgres";

/**
 * One shared Postgres connection pool.
 * On Supabase use the "Transaction pooler" connection string (port 6543).
 */
declare global {
  var __gchSql: ReturnType<typeof postgres> | undefined;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function createClient() {
  // "?pgbouncer=true" is a Prisma-only flag sometimes copied from Supabase; Postgres would reject it.
  const url = process.env.DATABASE_URL?.trim().replace(/([?&])pgbouncer=[^&]*&?/i, "$1").replace(/[?&]$/, "");
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add it to your environment variables (see README).");
  }
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return postgres(url, {
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    // Pool size must stay at least as large as the most queries any page runs at
    // once. postgres.js has no way to switch off pipelining: when every connection
    // is busy it queues further queries on an existing connection, and Supabase's
    // transaction pooler (Supavisor) stalls on those pipelined queries. The public
    // pages get all their filter counts from one shared query (facetSnapshot in
    // src/lib/jobs.ts), so the busiest ones run at most 5 queries at once (a job
    // list: results, their count, organizations, the counts, and one from the
    // page's metadata), and the admin dashboard runs its queries in batches of
    // at most 6. Keep new pages within this number, or raise it with
    // DATABASE_POOL_SIZE. Each serverless instance handles one request at a
    // time, so this stays bounded, and transaction-pooler connections are cheap
    // (they are multiplexed).
    max: Math.max(1, Number(process.env.DATABASE_POOL_SIZE) || 6),
    idle_timeout: 20,
    // Netlify stops a request after 10 seconds; fail fast instead of waiting 15 s for a connection.
    connect_timeout: 5,
    ssl: local ? false : "require",
    onnotice: () => {},
  });
}

/**
 * Time limits for one transaction, set with SET LOCAL (set_config(..., true)).
 * The transaction pooler (Supavisor, port 6543) does not keep session settings
 * or accept them as connection options, but a transaction always runs on one
 * server connection, so these apply to every statement inside it. Outside
 * transactions, a database-wide limit has to be set on the role in Supabase
 * (see README → "Database time limits").
 */
export const STATEMENT_TIMEOUT_MS = 8000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000;

/**
 * Runs fn in one transaction: everything commits together or nothing does.
 * If the function is stopped half-way (for example the host kills it), the
 * connection closes and Postgres rolls the transaction back.
 */
export async function transaction<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  const result = await getSql().begin(async (tx) => {
    await tx`select set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true),
                    set_config('idle_in_transaction_session_timeout', ${String(IDLE_IN_TRANSACTION_TIMEOUT_MS)}, true)`;
    return fn(tx);
  });
  return result as T;
}

/** Any query runner: the shared pool or a transaction. */
export type Db = ISql;
/** A transaction (has savepoint()). */
export type Tx = TransactionSql;

export function getSql() {
  if (!globalThis.__gchSql) globalThis.__gchSql = createClient();
  return globalThis.__gchSql;
}

/** Tagged-template shortcut: await sql`select 1` */
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply(_t, _this, args) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getSql() as any)(...args);
  },
  get(_t, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSql() as any;
    const v = client[prop];
    return typeof v === "function" ? v.bind(client) : v;
  },
});
