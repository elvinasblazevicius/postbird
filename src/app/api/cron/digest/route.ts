import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// No maxDuration export (see ../sync/route.ts). The weekly digest normally runs in GitHub Actions.

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const { runDigest } = await import("@/lib/digest");
  const result = await runDigest();
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
