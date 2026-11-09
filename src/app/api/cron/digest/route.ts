import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// No maxDuration export (see ../sync/route.ts). Scheduled emails normally run in GitHub Actions.

/**
 * The daily job, like scripts/digest.ts: first the billing safety checks (unconfirmed trials
 * canceled before they end, failed Paddle cancels retried), then the weekly digest (skips itself
 * when already sent this week), paid alerts (daily/weekly per subscriber) and plan emails
 * (welcome retries, trial reminders). A successful run stores its heartbeat (src/lib/heartbeat.ts).
 */
async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const { runAlerts, runDigest } = await import("@/lib/digest");
  const { runPlanEmails } = await import("@/lib/billing/notices");
  const { runBillingSafety } = await import("@/lib/billing/subscriptions");
  const { recordOpsEvent } = await import("@/lib/ops-events");
  const { recordDailyJob } = await import("@/lib/heartbeat");
  // Before any email: nothing here depends on email being set up.
  let billing: Awaited<ReturnType<typeof runBillingSafety>> | { failed: string };
  try {
    billing = await runBillingSafety();
  } catch (e) {
    billing = { failed: (e as Error).message };
    await recordOpsEvent("emails", `Billing safety checks failed: ${(e as Error).message}`);
  }
  const digest = await runDigest();
  const alerts = await runAlerts();
  const planEmails = await runPlanEmails();
  const failed = "failed" in billing || digest.status === "failed" || alerts.status === "failed";
  if (!failed && !("failed" in billing)) await recordDailyJob(billing);
  return NextResponse.json({ ...digest, billing, alerts, planEmails }, { status: failed ? 500 : 200, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
