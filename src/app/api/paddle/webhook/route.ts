import { after } from "next/server";
import { verifyPaddleSignature } from "@/lib/billing/paddle";
import { handlePaddleEvent, welcomeNotSent, type PaddleEvent } from "@/lib/billing/subscriptions";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/email-templates";
import { planDescription } from "@/lib/early-access-copy";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Larger bodies are not Paddle events this site needs (subscription events are a few KB). */
const MAX_BODY_BYTES = 512_000;

const reply = (status: number, body = "") => new Response(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Paddle Billing webhook (notification destination URL /api/paddle/webhook).
 * Verifies the Paddle-Signature header on the raw body, then records the
 * event once (by event_id) and mirrors the subscription onto the subscriber.
 * Answers within Paddle's 5-second limit: the database work is a few small
 * queries, and the welcome email is sent after the response.
 * Status codes: 200 handled or ignored, 401 bad signature, 400 unreadable
 * body, 500 processing failed (Paddle retries).
 */
export async function POST(req: Request) {
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.warn("paddle webhook: PADDLE_WEBHOOK_SECRET is not set");
    return reply(503);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413);
  const check = verifyPaddleSignature(raw, req.headers.get("paddle-signature"));
  if (!check.ok) {
    console.warn(`paddle webhook: signature rejected (${check.reason})`);
    return reply(401);
  }
  let event: PaddleEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return reply(400);
  }

  try {
    const res = await handlePaddleEvent(event);
    if (res.welcome) {
      const w = res.welcome;
      after(async () => {
        const accountUrl = absoluteUrl(`/account?t=${w.manageToken}`);
        const unsubscribeUrl = absoluteUrl(`/alerts/unsubscribe?token=${w.unsubscribeToken}`);
        const oneClick = absoluteUrl(`/api/unsubscribe?token=${w.unsubscribeToken}`);
        const sent = await sendEmail({
          to: w.email,
          ...welcomeEmail({ accountUrl, unsubscribeUrl, trialEndsAt: w.trialEndsAt, plan: planDescription(w.planInterval) }),
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        if (!sent.ok && !sent.skipped) {
          console.warn("paddle webhook: welcome email not sent", sent.error);
          await welcomeNotSent(w.email).catch(() => {});
        }
      });
    }
    return reply(200, res.outcome);
  } catch (e) {
    // Only the event type and the error message (no payload: it holds personal data).
    console.error(`paddle webhook: ${event?.event_type ?? "event"} failed`, (e as Error).message);
    return reply(500);
  }
}
