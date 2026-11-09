import { NextResponse } from "next/server";
import { openJobsByIds } from "@/lib/jobs";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { parseId } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Which of a visitor's saved vacancies (kept in their browser, see src/components/job-tools.tsx)
 * are still open: GET /api/saved?ids=12,34. Only vacancy numbers come in; nothing is stored.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  if (raw.length > 1300 || !/^[0-9,]*$/.test(raw)) return NextResponse.json({ error: "bad ids" }, { status: 400 });
  // A vacancy number is at most 12 digits; anything longer is not one of ours (and would overflow the query).
  const ids = raw.split(",").filter(Boolean).map(parseId);
  if (ids.some((id) => id === null)) return NextResponse.json({ error: "bad ids" }, { status: 400 });
  const allowed = await rateLimit(`saved|${clientIp(req.headers)}`, 60, 600).catch(() => true);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const jobs = await openJobsByIds(ids as number[]);
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
