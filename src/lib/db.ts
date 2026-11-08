import postgres from "postgres";

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
    // Enough connections for the largest page (about 12 queries at once). Supabase's
    // transaction pooler stalls when postgres.js has to queue several queries on one
    // connection, so the pool must never be smaller than a page's parallel queries.
    // Each serverless instance handles one request at a time, so this stays bounded.
    max: Number(process.env.DATABASE_POOL_SIZE || 15),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : "require",
    onnotice: () => {},
  });
}

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
