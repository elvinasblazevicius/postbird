/** Runs one feed sync from the command line. Usage: npm run sync */
import { getSql } from "../src/lib/db";
import { runSync } from "../src/lib/feeds/sync";

runSync("cli")
  .then(async (r) => { console.log(JSON.stringify(r, null, 2)); await getSql().end(); process.exit(r.status === "failed" ? 1 : 0); })
  .catch(async (e) => { console.error("Sync failed:", e); await getSql().end(); process.exit(1); });
