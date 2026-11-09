import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// No maxDuration export (see ../sync/route.ts). Scheduled emails normally run in GitHub Actions.

/**
 * The daily job, like scripts/digest.ts (runDailyJob in src/lib/digest.ts): first the billing safety
 * checks (unconfirmed trials canceled before they end, failed Paddle cancels retried), then the plan
 * emails (welcome retries, trial reminders), the weekly digest (skips itself when already sent this
 * week) and paid alerts (daily/weekly per subscriber). Each task runs even when an earlier one failed;
 * the answer is 500 if any failed. A successful run stores its heartbeat (src/lib/heartbeat.ts).
 */
async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const { runDailyJob } = await import("@/lib/digest");
  const { billing, planEmails, digest, alerts, failed } = await runDailyJob();
  return NextResponse.json({ ...digest, digest, billing, alerts, planEmails, failed }, { status: failed.length ? 500 : 200, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
