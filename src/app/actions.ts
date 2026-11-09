"use server";

import { headers } from "next/headers";
import siteConfig from "@site-config";
import { cleanCampaign, recordEvent, visitorFromHeaders } from "@/lib/analytics";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { planRenewal } from "@/lib/billing/notices";
import { confirmSubscriber, findByUnsubscribeToken, signup, unsubscribe, type SignupKind } from "@/lib/subscribers";

export type FormState = { status: "idle" | "success" | "error"; message: string };

const MESSAGES = {
  check_email: "Almost done. We've sent you an email — click the link inside to confirm.",
  email_not_configured: "Thanks, your address is saved. You'll get a confirmation email before we send anything else.",
} as const;

const earlyAccess = () =>
  `Email alerts aren't open yet: we're checking interest first. When they open you'll get one email offering the ${siteConfig.premium.trialDays}-day free trial. If we decide not to launch, we'll tell you and delete your address. Nothing is charged.`;

const WAITLIST_MESSAGES = {
  check_email: () => `You're almost on the early-access list. Please confirm with the link we just emailed you. ${earlyAccess()}`,
  email_not_configured: () => `You're on the early-access list. ${earlyAccess()}`,
} as const;

export async function signupAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Honeypot: real visitors never fill this hidden field.
  if (String(form.get("website") ?? "")) return { status: "success", message: MESSAGES.check_email };
  const h = await headers();
  if (!(await rateLimit(`signup:${clientIp(h)}`, 8, 3600))) {
    return { status: "error", message: "Too many sign-ups from this connection. Please try again in an hour." };
  }
  const isWaitlist = form.get("kind") === "waitlist";
  const kind = (form.get("kind") === "waitlist" ? "waitlist" : "alerts") as SignupKind;
  const prefs: Record<string, string> = {};
  for (const key of ["keywords", "organizations", "locations"]) {
    const v = String(form.get(key) ?? "").trim().slice(0, 200);
    if (v) prefs[key] = v;
  }
  // A saved search (the /jobs query string) or a job to be reminded about, when the trial was started from one.
  const search = String(form.get("search") ?? "");
  if (search && search.length <= 400 && /^[\w%=&+.,~-]*$/.test(search)) prefs.search = search;
  const remind = String(form.get("remind_job") ?? "");
  if (/^\d{1,12}$/.test(remind)) prefs.remind_job = remind;
  let attribution: Record<string, string> | null = null;
  try {
    attribution = cleanCampaign(JSON.parse(String(form.get("attribution") || "null")));
  } catch {
    attribution = null;
  }
  try {
    const res = await signup({
      attribution,
      visitor: visitorFromHeaders(h),
      email: String(form.get("email") ?? ""),
      kind,
      source: String(form.get("source") ?? "").slice(0, 40) || undefined,
      note: String(form.get("note") ?? "") || undefined,
      preferences: prefs,
    });
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "success", message: isWaitlist ? WAITLIST_MESSAGES[res.state]() : MESSAGES[res.state] };
  } catch (e) {
    console.error("signup failed", e);
    return { status: "error", message: "Something went wrong on our side. Please try again in a minute." };
  }
}

export async function confirmAction(_prev: FormState, form: FormData): Promise<FormState> {
  const t = String(form.get("token") ?? "");
  const res = await confirmSubscriber(t);
  if (!res.ok) return { status: "error", message: "This link has already been used or has expired. If you meant to sign up, please do so again." };
  // A plan started at checkout with an address that was already on our list (see applySubscription).
  if (res.paidPlan) return { status: "success", message: "Confirmed. Your alerts start with the next daily run, and we'll email you the link to your account page." };
  if (res.alerts) return { status: "success", message: "Confirmed. Your first email arrives with the next weekly round-up." };
  return { status: "success", message: `Confirmed: you're on the early-access list. ${earlyAccess()}` };
}

const PLAN_CHOICES = ["monthly", "three_months", "would_not_pay"] as const;

/** One-click "which plan would you choose?" answer after joining early access (anonymous). */
export async function planChoiceAction(choice: string, source: string): Promise<boolean> {
  // Server actions take whatever the client sends: check the types and lengths, not just the TypeScript signature.
  if (typeof choice !== "string" || typeof source !== "string" || choice.length > 40 || source.length > 100) return false;
  if (!(PLAN_CHOICES as readonly string[]).includes(choice)) return false;
  const h = await headers();
  if (!(await rateLimit(`plan:${clientIp(h)}`, 10, 3600))) return false;
  await recordEvent({ type: "plan_choice", visitor: visitorFromHeaders(h), props: { plan: choice, source: source.slice(0, 40) } });
  return true;
}

export async function unsubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const t = String(form.get("token") ?? "");
  await unsubscribe(t);
  // Unsubscribing stops emails, not a paid plan: say so when the plan will still charge.
  const sub = await findByUnsubscribeToken(t);
  const renewal = sub ? planRenewal(sub) : null;
  if (renewal?.chargesAhead) {
    return { status: "success", message: `You're unsubscribed from alerts. ${renewal.sentence} To stop payments, use “Cancel my plan” above.` };
  }
  return { status: "success", message: "You're unsubscribed. We won't email you again." };
}
