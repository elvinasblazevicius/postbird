"use server";

import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { clientIp, safeRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import siteConfig from "@site-config";

/** `values`: what was sent, so a form shown again after an error keeps what the visitor typed. */
export type FeedbackState = { status: "idle" | "success" | "error"; message: string; values?: Record<string, string> };

const KINDS = { feature: "Feature request", problem: "Something isn't working", other: "Other", contact: "Contact form", testimonial: "Experience shared" } as const;
/** What a contact-form message is about (its first line in the email and the admin list). */
const TOPICS = { question: "Question about the site", billing: "Billing or my subscription", problem: "Something isn't working", partnership: "Partnership or press", other: "Something else" } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * A message from /feedback (a feature request, a problem, a story to share) or /contact: stored,
 * and forwarded to the contact address. A contact message needs an address to reply to; a shared
 * story may carry the name to show and the author's permission to quote it.
 */
export async function feedbackAction(_prev: FeedbackState, form: FormData): Promise<FeedbackState> {
  // Honeypot: real visitors never fill this hidden field.
  if (String(form.get("website") ?? "")) return { status: "success", message: "" };
  const kind = String(form.get("kind") ?? "feature") as keyof typeof KINDS;
  const topicKey = String(form.get("topic") ?? "") as keyof typeof TOPICS;
  const topic = kind === "contact" && topicKey in TOPICS ? TOPICS[topicKey] : null;
  const body = String(form.get("message") ?? "").trim().slice(0, 2000);
  const message = topic ? `[${topic}] ${body}` : body;
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const page = String(form.get("page") ?? "").slice(0, 300) || null;
  const displayName = kind === "testimonial" ? String(form.get("display_name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null : null;
  const quoteOk = kind === "testimonial" && form.get("quote_ok") === "1";
  const values = { message: body, email, topic: topicKey, display_name: displayName ?? "", quote_ok: quoteOk ? "1" : "", kind };
  const fail = (message: string): FeedbackState => ({ status: "error", message, values });
  if (!(kind in KINDS)) return fail("Choose what your message is about.");
  if (body.length < 5) return fail(kind === "feature" ? "Please write a few words about your idea." : "Please write a few words.");
  if (kind === "contact" && !email) return fail("Add your email address so we can reply.");
  if (email && !EMAIL_RE.test(email)) return fail(kind === "contact" ? "That email address doesn't look right." : "That email address doesn't look right. You can also leave it empty.");
  if (quoteOk && !displayName) return fail("Add the name to show with your words, or untick the box.");

  const limit = await safeRateLimit(`feedback:${clientIp(await headers())}`, 5, 3600);
  if (limit === "limited") return fail("Thanks, we've had several messages from this connection. Please try again in an hour.");
  if (limit === "error") return fail("Something went wrong on our side. Please try again in a minute.");

  try {
    await sql`insert into feedback (kind, message, email, page, display_name, quote_ok) values (${kind}, ${message}, ${email || null}, ${page}, ${displayName}, ${quoteOk})`;
  } catch {
    return fail("Something went wrong on our side. Please try again in a minute.");
  }
  if (siteConfig.contactEmail) {
    const quote = kind === "testimonial" ? `\nName to show: ${displayName ?? "-"}\nMay be quoted: ${quoteOk ? "yes (approve it in Admin → Feedback)" : "no"}` : "";
    const text = `${KINDS[kind]}\n\n${message}\n\nFrom: ${email || "(no address given)"}\nPage: ${page ?? "-"}${quote}`;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    await sendEmail({
      to: siteConfig.contactEmail,
      subject: `${siteConfig.name}: ${KINDS[kind].toLowerCase()}`,
      text,
      html: `<p><strong>${esc(KINDS[kind])}</strong></p><p style="white-space:pre-wrap">${esc(message)}</p><p>From: ${esc(email || "(no address given)")}<br>Page: ${esc(page ?? "-")}${esc(quote).replace(/\n/g, "<br>")}</p>`,
      ...(email ? { headers: { "Reply-To": email } } : {}),
    }).catch(() => {});
  }
  return { status: "success", message: "" };
}
