import { cleanCampaign, recordEvent, isBot, visitorHash, type EventType } from "@/lib/analytics";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { cleanTrackedPath } from "./clean-path";

export const dynamic = "force-dynamic";

// Events the browser may send. Sign-ups are recorded on the server, not here.
const CLIENT_EVENTS: EventType[] = ["pageview", "job_view", "search", "apply_click", "premium_cta_click", "book_click"];

/** Per visitor IP: at most this many events per window. */
const EVENTS_PER_WINDOW = 120;
const WINDOW_SECONDS = 600;

export async function POST(req: Request) {
  const ua = req.headers.get("user-agent");
  if (isBot(ua)) return new Response(null, { status: 204 });
  let body: { type?: string; path?: string; jobId?: unknown; ref?: string; props?: Record<string, unknown> };
  try {
    const text = await req.text();
    if (text.length > 4000) return new Response(null, { status: 413 });
    body = JSON.parse(text);
    if (!body || typeof body !== "object") return new Response(null, { status: 400 });
  } catch {
    return new Response(null, { status: 400 });
  }
  const type = body.type as EventType;
  if (!CLIENT_EVENTS.includes(type)) return new Response(null, { status: 400 });

  const path = cleanTrackedPath(body.path);
  if (path === false) return new Response(null, { status: 204 }); // admin and alert-link pages are never recorded

  const ip = clientIp(req.headers);
  const allowed = await rateLimit(`track|${ip}`, EVENTS_PER_WINDOW, WINDOW_SECONDS).catch(() => true); // analytics never errors
  if (!allowed) return new Response(null, { status: 429 });
  let referrer: string | null = null;
  try {
    if (body.ref) {
      const host = new URL(body.ref).hostname.replace(/^www\./, "");
      const own = new URL(req.url).hostname.replace(/^www\./, "");
      referrer = host && host !== own ? host : null;
    }
  } catch {
    referrer = null;
  }
  const rawId = typeof body.jobId === "string" && /^\d{1,12}$/.test(body.jobId) ? Number(body.jobId) : body.jobId;
  const jobId = typeof rawId === "number" && Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  let props: Record<string, unknown> | null = null;
  if (body.props && typeof body.props === "object") {
    if (type === "search") {
      // Only the known filter fields, trimmed.
      const keys = ["q", "org", "country", "region", "category", "remote", "type", "posted", "closing", "grade", "orgtype", "lang", "exp", "results"];
      props = Object.fromEntries(
        keys.filter((k) => body.props![k] !== undefined && body.props![k] !== null)
          .map((k) => [k, typeof body.props![k] === "string" ? (body.props![k] as string).slice(0, 120) : typeof body.props![k] === "number" || typeof body.props![k] === "boolean" ? body.props![k] : null]),
      );
    }
    if ((type === "premium_cta_click" || type === "book_click") && typeof body.props.source === "string") props = { source: body.props.source.slice(0, 40) };
    if (type === "pageview") {
      const campaign = cleanCampaign(body.props.campaign as Record<string, unknown> | undefined);
      props = campaign ? { campaign } : null;
    }
  }

  await recordEvent({
    type,
    path,
    jobId,
    visitor: visitorHash(ip, ua ?? ""),
    referrer,
    props,
  });
  return new Response(null, { status: 204 });
}
