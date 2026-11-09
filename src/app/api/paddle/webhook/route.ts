import { after } from "next/server";
import { verifyPaddleSignature } from "@/lib/billing/paddle";
import { confirmationNotSent, confirmationSent, sendPaidConfirmation, sendWelcomeEmail } from "@/lib/billing/notices";
import { cancelBlockedTrial, handlePaddleEvent, welcomeNotSent, welcomeSent, type PaddleEvent } from "@/lib/billing/subscriptions";

export const dynamic = "force-dynamic";

/** Larger bodies are not Paddle events this site needs (subscription events are a few KB). */
const MAX_BODY_BYTES = 512_000;

const reply = (status: number, body = "") => new Response(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Paddle Billing webhook (notification destination URL /api/paddle/webhook).
 * Verifies the Paddle-Signature header on the raw body, then records the
 * event once (by event_id) and mirrors the subscription onto the subscriber,
 * both in one transaction (see handlePaddleEvent).
 * Answers within Paddle's 5-second limit: the database work is a few small
 * queries (plus at most two short calls to Paddle's API before it), and emails
 * (welcome, or a confirmation link for an address the checkout didn't create)
 * and canceling a trial the address may not have happen after the response.
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
        const sent = await sendWelcomeEmail(w);
        // Sent: end the claim's lease. If this task is stopped before getting here, the
        // daily job sends it again after 30 minutes, under the same idempotency key.
        if (sent.ok) await welcomeSent(w.subscriberId).catch(() => {});
        else if (!sent.skipped) {
          // The daily job sends it again (welcome_sent_at is null again).
          console.warn("paddle webhook: welcome email not sent", sent.error);
          await welcomeNotSent(w.subscriberId).catch(() => {});
        }
      });
    }
    if (res.confirm) {
      const c = res.confirm;
      after(async () => {
        const sent = await sendPaidConfirmation(c);
        if (sent.ok) await confirmationSent(c.subscriberId).catch(() => {});
        else if (!sent.skipped) {
          console.warn("paddle webhook: confirmation email not sent", sent.error);
          await confirmationNotSent(c.subscriberId).catch(() => {});
        }
      });
    }
    if (res.cancel) {
      // A free trial this address may not have: canceled in Paddle at once (the result is on its flag).
      const c = res.cancel;
      after(async () => {
        await cancelBlockedTrial(c.subscriptionId).catch(() => {});
      });
    }
    return reply(200, res.outcome);
  } catch (e) {
    // Only the event type and the error message (no payload: it holds personal data).
    console.error(`paddle webhook: ${event?.event_type ?? "event"} failed`, (e as Error).message);
    return reply(500);
  }
}
