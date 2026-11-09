/**
 * The daily job from the command line (runDailyJob in src/lib/digest.ts), in this order:
 * the billing safety checks (runBillingSafety: trials at addresses nobody confirmed are
 * canceled before they end, failed Paddle cancels are retried, unchecked Paddle customers
 * are checked again; needs PADDLE_API_KEY), the plan emails (welcome emails that failed
 * before, confirmation links that failed before or are due again, trial-ending reminders),
 * the weekly digest (when due) and the paid alerts. Each task runs even when an earlier
 * one failed; the job exits non-zero if any failed. A successful run ends by storing its
 * heartbeat (src/lib/heartbeat.ts): Admin → Overview warns when none came for 26 hours.
 * Usage: npm run digest
 */
import { BILLING_LIVE } from "../src/lib/billing/live";
import { getSql } from "../src/lib/db";
import { runDailyJob } from "../src/lib/digest";
import { recordOpsEvent } from "../src/lib/ops-events";

/** A GitHub Actions annotation's text on one line. */
const annotation = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

async function main() {
  // Each task runs on its own (runDailyJob): one that fails is recorded and the next still runs.
  const { billing, planEmails, digest, alerts, failed } = await runDailyJob();
  console.log(JSON.stringify({ billing, planEmails, digest, alerts }, null, 2));
  if ("skipped" in billing && BILLING_LIVE) {
    console.log(`::error title=Billing safety::${billing.skipped} Add the PADDLE_API_KEY and NEXT_PUBLIC_PADDLE_ENV repository secrets (README Step 4): unconfirmed trials can't be canceled without them.`);
  }
  if ("unconfirmed" in billing) {
    const failedCancels = billing.unconfirmed.failed + billing.cancelRetries.failed;
    if (failedCancels) console.log(`::error title=Billing safety::${failedCancels} subscription(s) could not be canceled in Paddle. The next daily run tries again; see Admin → Overview.`);
  }
  if ("welcome" in planEmails) {
    const failedPlan = planEmails.welcome.failed + planEmails.confirmations.failed + planEmails.trialReminders.failed;
    if (failedPlan) console.log(`::warning title=Plan emails::${failedPlan} plan email(s) were not sent; the next daily run tries again.`);
  }
  for (const [title, r] of [["Weekly email", digest], ["Alerts", alerts]] as const) {
    if ("status" in r && r.status !== "failed" && r.failed) {
      console.log(`::warning title=${title}::${annotation(`${r.failed} email(s) were not sent (${r.message ?? "no details"}); the next daily run tries again.`)}`);
    }
  }
  await getSql().end();
  // A failed task must fail the scheduled job so it shows up in GitHub Actions.
  if (failed.length) {
    console.log(`::error::${annotation(failed.join(" "))}`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(e);
  await recordOpsEvent("emails", `Scheduled emails stopped: ${(e as Error)?.message ?? String(e)}`);
  await getSql().end();
  process.exit(1);
});
