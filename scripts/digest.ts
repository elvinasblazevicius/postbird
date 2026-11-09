/**
 * Sends the scheduled emails from the command line: the weekly digest (when
 * due), paid alerts, and the plan emails (welcome emails that failed before,
 * confirmation links that failed before or are due again, trial-ending reminders).
 * First, the billing safety checks (runBillingSafety): trials at addresses
 * nobody confirmed are canceled before they end, failed Paddle cancels are
 * retried, and unchecked Paddle customers are checked again (needs PADDLE_API_KEY).
 * A successful run ends by storing its heartbeat (src/lib/heartbeat.ts): Admin →
 * Overview warns when none came for 26 hours.
 * Usage: npm run digest
 */
import { runPlanEmails } from "../src/lib/billing/notices";
import { runBillingSafety, type BillingSafetyResult } from "../src/lib/billing/subscriptions";
import { BILLING_LIVE } from "../src/lib/billing/live";
import { getSql } from "../src/lib/db";
import { runAlerts, runDigest } from "../src/lib/digest";
import { recordDailyJob } from "../src/lib/heartbeat";
import { recordOpsEvent } from "../src/lib/ops-events";

async function main() {
  // Before any email: nothing here depends on email being set up.
  let billing: BillingSafetyResult | { failed: string };
  try {
    billing = await runBillingSafety();
  } catch (e) {
    billing = { failed: (e as Error).message };
    await recordOpsEvent("emails", `Billing safety checks failed: ${(e as Error).message}`);
  }
  // The weekly digest skips itself when this week's was already sent, so running daily is safe.
  const digest = await runDigest();
  const alerts = await runAlerts();
  const planEmails = await runPlanEmails();
  console.log(JSON.stringify({ billing, digest, alerts, planEmails }, null, 2));
  if ("skipped" in billing && BILLING_LIVE) {
    console.log(`::error title=Billing safety::${billing.skipped} Add the PADDLE_API_KEY and NEXT_PUBLIC_PADDLE_ENV repository secrets (README Step 4): unconfirmed trials can't be canceled without them.`);
  }
  if ("unconfirmed" in billing) {
    const failedCancels = billing.unconfirmed.failed + billing.cancelRetries.failed;
    if (failedCancels) {
      await recordOpsEvent("emails", `${failedCancels} subscription(s) could not be canceled in Paddle; see Admin → Overview → Billing flags.`);
      console.log(`::error title=Billing safety::${failedCancels} subscription(s) could not be canceled in Paddle. The next daily run tries again; see Admin → Overview.`);
    }
  }
  // A run that sent nothing because everything failed is shown on Admin → Overview.
  if (digest.status === "failed") await recordOpsEvent("emails", `Weekly email failed: ${digest.message ?? "no details"}`);
  if (alerts.status === "failed") await recordOpsEvent("emails", `Alerts failed: ${alerts.message ?? "no details"}`);
  // A failed run must fail the scheduled job so it shows up in GitHub Actions.
  const failed = ["failed" in billing ? `Billing safety checks failed: ${billing.failed}` : null, digest.status === "failed" ? `Digest failed: ${digest.message ?? ""}` : null, alerts.status === "failed" ? `Alerts failed: ${alerts.message ?? ""}` : null].filter(Boolean);
  // Only a successful run counts as the day's run (Admin → Overview, /api/health).
  if (!failed.length && !("failed" in billing)) await recordDailyJob(billing);
  await getSql().end();
  if ("welcome" in planEmails) {
    const failedPlan = planEmails.welcome.failed + planEmails.confirmations.failed + planEmails.trialReminders.failed;
    if (failedPlan) console.log(`::warning title=Plan emails::${failedPlan} plan email(s) were not sent; the next daily run tries again.`);
  }
  if (failed.length) {
    console.log(`::error::${failed.join(" ").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(e);
  await recordOpsEvent("emails", `Scheduled emails stopped: ${(e as Error)?.message ?? String(e)}`);
  await getSql().end();
  process.exit(1);
});
