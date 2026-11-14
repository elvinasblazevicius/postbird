/**
 * The same tidy every scheduled import runs (src/lib/feeds/tidy.ts), on demand, with a report of
 * each change. Usage: npm run tidy-jobs [-- --dry-run]   (or the "tidy-jobs" option of the GitHub workflow)
 */
import { getSql } from "../src/lib/db";
import { tidyListings } from "../src/lib/feeds/tidy";

const dryRun = process.argv.includes("--dry-run");

tidyListings({ dryRun })
  .then((r) => {
    for (const l of r.lines) console.log(l);
    console.log(`${r.checked} open jobs: ${r.titles} titles, ${r.employers} employers, ${r.descriptions} descriptions, ${r.grades} grades, ${r.places} places ${dryRun ? "to change (dry run, nothing written)" : "changed"}.`);
  })
  .then(() => getSql().end({ timeout: 2 }))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await getSql().end({ timeout: 2 });
    process.exit(1);
  });
