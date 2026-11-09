/** Sends this week's digest from the command line. Usage: npm run digest */
import { getSql } from "../src/lib/db";
import { runDigest } from "../src/lib/digest";

runDigest()
  .then(async (r) => {
    console.log(JSON.stringify(r, null, 2));
    await getSql().end();
    // A failed digest must fail the scheduled job so it shows up in GitHub Actions.
    if (r.status === "failed") {
      console.log(`::error::Digest failed${r.message ? `: ${r.message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}` : ""}`);
      process.exit(1);
    }
  })
  .catch(async (e) => { console.error(e); await getSql().end(); process.exit(1); });
