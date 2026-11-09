/**
 * Sends the scheduled emails from the command line: the weekly digest (when
 * due), paid alerts, and the plan emails (welcome emails that failed before,
 * confirmation links that failed before, trial-ending reminders).
 * Usage: npm run digest
 */
import { runPlanEmails } from "../src/lib/billing/notices";
import { getSql } from "../src/lib/db";
import { runAlerts, runDigest } from "../src/lib/digest";

async function main() {
  // The weekly digest skips itself when this week's was already sent, so running daily is safe.
  const digest = await runDigest();
  const alerts = await runAlerts();
  const planEmails = await runPlanEmails();
  console.log(JSON.stringify({ digest, alerts, planEmails }, null, 2));
  await getSql().end();
  if ("welcome" in planEmails) {
    const failedPlan = planEmails.welcome.failed + planEmails.confirmations.failed + planEmails.trialReminders.failed;
    if (failedPlan) console.log(`::warning title=Plan emails::${failedPlan} plan email(s) were not sent; the next daily run tries again.`);
  }
  // A failed run must fail the scheduled job so it shows up in GitHub Actions.
  const failed = [digest.status === "failed" ? `Digest failed: ${digest.message ?? ""}` : null, alerts.status === "failed" ? `Alerts failed: ${alerts.message ?? ""}` : null].filter(Boolean);
  if (failed.length) {
    console.log(`::error::${failed.join(" ").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
    process.exit(1);
  }
}

main().catch(async (e) => { console.error(e); await getSql().end(); process.exit(1); });
