"use server";

import { headers } from "next/headers";
import { cleanCampaign, visitorFromHeaders } from "@/lib/analytics";
import { confirmSubscriber, signup, unsubscribe, type SignupKind } from "@/lib/subscribers";

export type FormState = { status: "idle" | "success" | "error"; message: string };

const MESSAGES = {
  check_email: "Almost done. We've sent you an email — click the link inside to confirm.",
  already_confirmed: "You're already subscribed with this address. You're all set.",
  email_not_configured: "Thanks, your address is saved. You'll get a confirmation email before we send anything else.",
} as const;

export async function signupAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Honeypot: real visitors never fill this hidden field.
  if (String(form.get("website") ?? "")) return { status: "success", message: MESSAGES.check_email };
  const kind = (form.get("kind") === "waitlist" ? "waitlist" : "alerts") as SignupKind;
  const prefs: Record<string, string> = {};
  for (const key of ["keywords", "organizations", "locations"]) {
    const v = String(form.get(key) ?? "").trim().slice(0, 200);
    if (v) prefs[key] = v;
  }
  let attribution: Record<string, string> | null = null;
  try {
    attribution = cleanCampaign(JSON.parse(String(form.get("attribution") || "null")));
  } catch {
    attribution = null;
  }
  try {
    const res = await signup({
      attribution,
      visitor: visitorFromHeaders(await headers()),
      email: String(form.get("email") ?? ""),
      kind,
      source: String(form.get("source") ?? "").slice(0, 40) || undefined,
      note: String(form.get("note") ?? "") || undefined,
      preferences: prefs,
    });
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "success", message: MESSAGES[res.state] };
  } catch (e) {
    console.error("signup failed", e);
    return { status: "error", message: "Something went wrong on our side. Please try again in a minute." };
  }
}

export async function confirmAction(_prev: FormState, form: FormData): Promise<FormState> {
  const t = String(form.get("token") ?? "");
  const ok = await confirmSubscriber(t);
  return ok
    ? { status: "success", message: "Confirmed. Your first email arrives with the next weekly round-up." }
    : { status: "error", message: "This link has already been used or has expired. If you're not receiving emails, sign up again." };
}

export async function unsubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const t = String(form.get("token") ?? "");
  await unsubscribe(t);
  return { status: "success", message: "You're unsubscribed. We won't email you again." };
}
