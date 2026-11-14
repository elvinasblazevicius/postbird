import { after } from "next/server";
import { isBot } from "@/lib/analytics";
import { parseMetaMatch, sendCapiEvent } from "@/lib/meta-capi";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { readCapped } from "@/lib/read-capped";
import { cleanTrackedPath } from "../track/clean-path";

export const dynamic = "force-dynamic";

/**
 * A page view sent on to Meta's Conversions API, so it is counted when a browser or network blocks
 * Meta's script (src/components/ads.tsx sends it, with the pixel's own event id, only when
 * advertising measurement is allowed). Only "PageView"; conversions are sent where they happen.
 * Never a private page (account, admin, alert links). Answers at once; the call to Meta runs after.
 */
export async function POST(req: Request) {
  const ua = req.headers.get("user-agent");
  if (isBot(ua)) return new Response(null, { status: 204 });
  let body: { event?: unknown; meta?: unknown };
  try {
    const text = await readCapped(req, 2000);
    if (text === null) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (body?.event !== "PageView") return new Response(null, { status: 400 });
  const match = parseMetaMatch(body.meta);
  if (!match) return new Response(null, { status: 204 }); // no consent marker: nothing is sent
  if (match.url) {
    try {
      if (cleanTrackedPath(new URL(match.url).pathname) === false) return new Response(null, { status: 204 });
    } catch {
      return new Response(null, { status: 204 });
    }
  }
  const ip = clientIp(req.headers);
  const allowed = await rateLimit(`meta|${ip}`, 60, 600).catch(() => true);
  if (!allowed) return new Response(null, { status: 429 });
  after(() => sendCapiEvent({ event: "PageView", match, ip, ua }).then(() => undefined));
  return new Response(null, { status: 204 });
}
