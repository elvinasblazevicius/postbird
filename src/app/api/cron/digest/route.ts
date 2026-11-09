import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// No maxDuration export (see ../sync/route.ts). Scheduled emails normally run in GitHub Actions.

/** Weekly digest (skips itself when already sent this week), paid alerts (daily/weekly per subscriber) and plan emails (welcome retries, trial reminders). */
async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const { runAlerts, runDigest } = await import("@/lib/digest");
  const { runPlanEmails } = await import("@/lib/billing/notices");
  const digest = await runDigest();
  const alerts = await runAlerts();
  const planEmails = await runPlanEmails();
  const failed = digest.status === "failed" || alerts.status === "failed";
  return NextResponse.json({ ...digest, alerts, planEmails }, { status: failed ? 500 : 200, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
