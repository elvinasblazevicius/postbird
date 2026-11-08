import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runSync } from "@/lib/feeds/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runSync("cron");
  // 200 even for partial results so schedulers don't retry in a loop; the admin shows details.
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
