/** Runs one feed sync from the command line. Usage: npm run sync */
import { getSql } from "../src/lib/db";
import { runSync, type SyncResult } from "../src/lib/feeds/sync";
import { recordOpsEvent } from "../src/lib/ops-events";

/** Escapes text for a GitHub Actions workflow command (::warning::…). */
const ghEscape = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** Problems worth a visible warning in the GitHub Actions run summary. */
function feedWarnings(r: SyncResult): string[] {
  const out: string[] = [];
  for (const f of r.feeds) {
    if (f.status === "error") out.push(`::warning title=Feed error::Feed "${ghEscape(f.name)}" (id ${f.id}) failed: ${ghEscape(f.error ?? "unknown error")}`);
    else if (f.status === "ok" && f.items === 0) out.push(`::warning title=Empty feed::Feed "${ghEscape(f.name)}" (id ${f.id}) returned 0 items.`);
  }
  return out;
}

runSync("cli")
  .then(async (r) => {
    console.log(JSON.stringify(r, null, 2));
    for (const w of feedWarnings(r)) console.log(w);
    // Shown on Admin → Overview until marked as dealt with.
    if (r.status === "failed") await recordOpsEvent("sync", `Scheduled import failed: ${r.message ?? "no details"}`);
    await getSql().end();
    process.exit(r.status === "failed" ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("Sync failed:", e);
    await recordOpsEvent("sync", `Scheduled import stopped: ${(e as Error)?.message ?? String(e)}`);
    await getSql().end();
    process.exit(1);
  });
