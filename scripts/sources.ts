/**
 * Read-only report: which websites the feeds' items came from in the last 14 days, and what the
 * import did with them (created, updated, skipped…). Use it to find sources to remove from the
 * Inoreader folder. Run with `npm run sources` (or the "sources" option of the GitHub workflow).
 */
import postgres from "postgres";

const url = (process.env.DATABASE_URL ?? "").trim().replace(/([?&])pgbouncer=[^&]*&?/i, "$1").replace(/[?&]$/, "");
if (!url) throw new Error("DATABASE_URL is not set");

async function main() {
  const sql = postgres(url, { prepare: false, max: 1, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : "require", onnotice: () => {} });
  const rows = await sql<{ host: string; outcome: string; n: number; example: string | null }[]>`
    select lower(regexp_replace(substring(url from '^[a-z]+://([^/:?#]+)'), '^www\\.', '')) as host,
           outcome, count(*)::int as n, min(title) as example
      from sync_items
     where created_at > now() - interval '14 days' and url is not null
     group by 1, 2`;
  const byHost = new Map<string, { total: number; outcomes: Record<string, number>; example: string | null }>();
  for (const r of rows) {
    const h = byHost.get(r.host) ?? { total: 0, outcomes: {}, example: r.example };
    h.total += r.n;
    h.outcomes[r.outcome] = r.n;
    byHost.set(r.host, h);
  }
  console.log("Sources in the last 14 days (website: items, outcomes, example title)");
  for (const [host, h] of [...byHost].sort((a, b) => b[1].total - a[1].total)) {
    const outcomes = Object.entries(h.outcomes).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`${host}: ${h.total} (${outcomes}) e.g. "${(h.example ?? "").slice(0, 70)}"`);
  }
  await sql.end({ timeout: 2 });
}
main().then(() => process.exit(0));
