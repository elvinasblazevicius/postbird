/**
 * Email sending through Resend's HTTP API (no SDK needed).
 * Without RESEND_API_KEY nothing is sent (sign-ups still work while you set
 * up email). Only a one-line notice is logged: never the recipient or body,
 * which contain personal data and confirmation tokens.
 */
import siteConfig from "@site-config";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SendResult = { ok: boolean; skipped?: boolean; id?: string; error?: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || siteConfig.emailFrom;
}

export async function sendEmail(msg: OutgoingEmail): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.info("email not sent: RESEND_API_KEY missing");
    return { ok: false, skipped: true, error: "Email sending is not configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress(), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `Resend returned HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Send up to 100 emails per request (Resend batch API). */
export async function sendBatch(msgs: OutgoingEmail[]): Promise<{ sent: number; failed: number; errors: string[] }> {
  const out = { sent: 0, failed: 0, errors: [] as string[] };
  if (!isEmailConfigured()) {
    if (msgs.length) console.info("email not sent: RESEND_API_KEY missing");
    out.failed = msgs.length;
    out.errors.push("Email sending is not configured (RESEND_API_KEY missing)");
    return out;
  }
  for (let i = 0; i < msgs.length; i += 100) {
    const chunk = msgs.slice(i, i + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((m) => ({ from: fromAddress(), to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }))),
      });
      if (res.ok) out.sent += chunk.length;
      else {
        out.failed += chunk.length;
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        out.errors.push(data.message || `Resend returned HTTP ${res.status}`);
      }
    } catch (e) {
      out.failed += chunk.length;
      out.errors.push((e as Error).message);
    }
  }
  return out;
}
