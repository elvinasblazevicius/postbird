/** Sends this week's digest from the command line. Usage: npm run digest */
import { getSql } from "../src/lib/db";
import { runDigest } from "../src/lib/digest";

runDigest()
  .then(async (r) => { console.log(JSON.stringify(r, null, 2)); await getSql().end(); })
  .catch(async (e) => { console.error(e); await getSql().end(); process.exit(1); });
