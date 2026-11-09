import { after } from "next/server";
import { sendPlanStillActiveNotice } from "@/lib/billing/notices";
import { unsubscribe } from "@/lib/subscribers";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (RFC 8058) used by Gmail/Outlook "Unsubscribe" buttons.
 * It always unsubscribes. Unsubscribing stops emails, not a paid plan, so a
 * subscriber whose plan will still charge them gets ONE email saying so, with
 * the link to cancel (sent after the response; only when this request
 * actually unsubscribed them, and with an idempotency key).
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const id = token ? await unsubscribe(token) : null;
  if (id !== null) {
    after(async () => {
      const sent = await sendPlanStillActiveNotice(id).catch((e: Error) => ({ ok: false, skipped: false, error: e.message }));
      if (sent && !sent.ok && !sent.skipped) console.warn("unsubscribe: plan notice not sent", sent.error);
    });
  }
  return new Response("Unsubscribed", { status: 200, headers: { "cache-control": "no-store" } });
}

/**
 * A GET of the one-click address (someone opened the List-Unsubscribe link in
 * a browser, or a mail scanner followed it) never unsubscribes: it sends the
 * visitor to the unsubscribe page, which asks them to confirm. Link scanners
 * prefetch GETs, so only the RFC 8058 POST unsubscribes.
 */
export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get("token") ?? "").slice(0, 100);
  const location = token ? `/alerts/unsubscribe?token=${encodeURIComponent(token)}` : "/alerts/unsubscribe";
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}
