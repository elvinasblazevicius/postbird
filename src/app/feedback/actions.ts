"use server";

import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { clientIp, safeRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import siteConfig from "@site-config";

export type FeedbackState = { status: "idle" | "success" | "error"; message: string };

const KINDS = { feature: "Feature request", problem: "Something isn't working", other: "Other" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A feature request (or a problem report) from /feedback: stored, and forwarded to the contact address. */
export async function feedbackAction(_prev: FeedbackState, form: FormData): Promise<FeedbackState> {
  // Honeypot: real visitors never fill this hidden field.
  if (String(form.get("website") ?? "")) return { status: "success", message: "" };
  const kind = String(form.get("kind") ?? "feature") as keyof typeof KINDS;
  const message = String(form.get("message") ?? "").trim().slice(0, 2000);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const page = String(form.get("page") ?? "").slice(0, 300) || null;
  if (!(kind in KINDS)) return { status: "error", message: "Choose what your message is about." };
  if (message.length < 5) return { status: "error", message: "Please write a few words about your idea." };
  if (email && !EMAIL_RE.test(email)) return { status: "error", message: "That email address doesn't look right. You can also leave it empty." };

  const limit = await safeRateLimit(`feedback:${clientIp(await headers())}`, 5, 3600);
  if (limit === "limited") return { status: "error", message: "Thanks, we've had several messages from this connection. Please try again in an hour." };
  if (limit === "error") return { status: "error", message: "Something went wrong on our side. Please try again in a minute." };

  try {
    await sql`insert into feedback (kind, message, email, page) values (${kind}, ${message}, ${email || null}, ${page})`;
  } catch {
    return { status: "error", message: "Something went wrong on our side. Please try again in a minute." };
  }
  if (siteConfig.contactEmail) {
    const text = `${KINDS[kind]}\n\n${message}\n\nFrom: ${email || "(no address given)"}\nPage: ${page ?? "-"}`;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    await sendEmail({
      to: siteConfig.contactEmail,
      subject: `${siteConfig.name}: ${KINDS[kind].toLowerCase()}`,
      text,
      html: `<p><strong>${esc(KINDS[kind])}</strong></p><p style="white-space:pre-wrap">${esc(message)}</p><p>From: ${esc(email || "(no address given)")}<br>Page: ${esc(page ?? "-")}</p>`,
      ...(email ? { headers: { "Reply-To": email } } : {}),
    }).catch(() => {});
  }
  return { status: "success", message: "" };
}
