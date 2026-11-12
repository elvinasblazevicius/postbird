"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import siteConfig from "@site-config";
import { cleanCampaign, recordEvent, visitorFromHeaders } from "@/lib/analytics";
import { clientIp, safeRateLimit } from "@/lib/rate-limit";
import { planRenewal, runWelcomeRetries } from "@/lib/billing/notices";
import { confirmSubscriber, findByUnsubscribeToken, signup, unsubscribe, type SignupKind } from "@/lib/subscribers";

export type FormState = {
  status: "idle" | "success" | "error";
  message: string;
  /** A next step shown after the message (a link on this site). */
  link?: { href: string; label: string };
  /** After a confirmation: what was confirmed, for the page's heading and buttons. */
  confirmed?: { kind: "weekly" | "paid" | "trialCanceled" | "waitlist" | "address"; offerDaily: boolean };
};

const SERVER_ERROR = "Something went wrong on our side. Please try again in a minute.";

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
  const limit = await safeRateLimit(`signup:${clientIp(h)}`, 8, 3600);
  if (limit === "error") return { status: "error", message: SERVER_ERROR };
  if (limit === "limited") {
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
  const validSearch = search.length <= 400 && /^[\w%=&+.,~-]*$/.test(search);
  if (search && validSearch) prefs.search = search;
  // The free weekly email follows the search chosen here ("" = the week's newest vacancies).
  const weeklySearch = kind === "alerts" && siteConfig.freeWeeklyEmail ? (validSearch ? search : "") : null;
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
      weeklySearch,
    });
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "success", message: isWaitlist ? WAITLIST_MESSAGES[res.state]() : MESSAGES[res.state] };
  } catch (e) {
    console.error("signup failed", e);
    return { status: "error", message: SERVER_ERROR };
  }
}

export async function confirmAction(_prev: FormState, form: FormData): Promise<FormState> {
  const t = String(form.get("token") ?? "");
  let res: Awaited<ReturnType<typeof confirmSubscriber>>;
  try {
    res = await confirmSubscriber(t);
  } catch (e) {
    console.error("confirm failed", (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
  if (!res.ok) return { status: "error", message: "This link has already been used or has expired. If you meant to sign up, please do so again." };
  // A plan started at checkout with an address that wasn't proven yet (see applySubscription):
  // the welcome email with the account link goes out now (the daily job retries it if sending fails).
  if (res.paidPlan) {
    const id = res.id;
    after(async () => {
      await runWelcomeRetries(1, id).catch((e: Error) => console.error("welcome after confirmation failed", e.message));
    });
    return { status: "success", message: "Confirmed. We'll email you the link to your account page now, and your alerts start with the next daily run.", confirmed: { kind: "paid", offerDaily: false } };
  }
  // A trial at this address was canceled because it wasn't confirmed in time: it didn't use up the free trial.
  if (res.trialCanceled) {
    const weekly = res.weeklyEmail ? " Your weekly email comes on Mondays, and only when there are new vacancies that match your search." : "";
    return {
      status: "success",
      message: `Your trial was canceled because the address wasn't confirmed in time. You can start it again.${weekly}`,
      link: { href: "/pricing/trial", label: "Start the free trial" },
      confirmed: { kind: "trialCanceled", offerDaily: false },
    };
  }
  if (res.weeklyEmail) {
    // A sign-up from a Meta ad came for the free email: the page doesn't offer it the paid plan.
    return { status: "success", message: "Confirmed. Your weekly email comes on Mondays, and only when there are new vacancies that match your search.", confirmed: { kind: "weekly", offerDaily: !res.fromMetaAd } };
  }
  if (res.waitlist) return { status: "success", message: `Confirmed: you're on the early-access list. ${earlyAccess()}`, confirmed: { kind: "waitlist", offerDaily: false } };
  return { status: "success", message: "Your address is confirmed.", confirmed: { kind: "address", offerDaily: false } };
}

const PLAN_CHOICES = ["monthly", "three_months", "would_not_pay"] as const;

/** One-click "which plan would you choose?" answer after joining early access (anonymous). */
export async function planChoiceAction(choice: string, source: string): Promise<boolean> {
  // Server actions take whatever the client sends: check the types and lengths, not just the TypeScript signature.
  if (typeof choice !== "string" || typeof source !== "string" || choice.length > 40 || source.length > 100) return false;
  if (!(PLAN_CHOICES as readonly string[]).includes(choice)) return false;
  const h = await headers();
  if ((await safeRateLimit(`plan:${clientIp(h)}`, 10, 3600)) !== "ok") return false;
  await recordEvent({ type: "plan_choice", visitor: visitorFromHeaders(h), props: { plan: choice, source: source.slice(0, 40) } });
  return true;
}

export async function unsubscribeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const t = String(form.get("token") ?? "");
  let sub: Awaited<ReturnType<typeof findByUnsubscribeToken>>;
  try {
    await unsubscribe(t);
    sub = await findByUnsubscribeToken(t);
  } catch (e) {
    console.error("unsubscribe failed", (e as Error).message);
    return { status: "error", message: SERVER_ERROR };
  }
  // Unsubscribing stops emails, not a paid plan: say so when the plan will still charge.
  const renewal = sub ? planRenewal(sub) : null;
  if (renewal?.chargesAhead) {
    return { status: "success", message: `You're unsubscribed from alerts. ${renewal.sentence} To stop payments, use “Cancel my plan” above.` };
  }
  return { status: "success", message: "You're unsubscribed. We won't email you again." };
}
