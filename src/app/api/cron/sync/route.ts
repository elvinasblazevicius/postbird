import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// No maxDuration export: Netlify's free plan allows 10 s per request, and the
// sync's own time budget (src/lib/feeds/sync.ts) keeps website-triggered runs
// inside that. Scheduled imports run in GitHub Actions without a limit.

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  // Loaded only after the secret is checked, so a problem in the import
  // pipeline can never turn an unauthorized request into a 500.
  const { runSync } = await import("@/lib/feeds/sync");
  const result = await runSync("cron");
  // 200 even for partial results so schedulers don't retry in a loop; the admin shows details.
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
