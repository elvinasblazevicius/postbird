import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/site";
import { recordEvent } from "@/lib/analytics";

export type SignupKind = "alerts" | "waitlist";

export type SignupResult =
  | { ok: true; state: "check_email" | "already_confirmed" | "email_not_configured" }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const token = () => randomBytes(24).toString("base64url");

type SubRow = { id: number; status: string; confirm_token: string | null; confirm_sent_at: Date | null; wants_alerts: boolean; premium_waitlist: boolean };

/**
 * Double opt-in sign-up. Stores the address as "pending" and sends a
 * confirmation link; nothing is emailed afterwards until it's confirmed.
 */
export async function signup(opts: { email: string; kind: SignupKind; source?: string; note?: string; preferences?: Record<string, string>; attribution?: Record<string, string> | null; visitor?: string | null }): Promise<SignupResult> {
  const email = normalizeEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const isWaitlist = opts.kind === "waitlist";
  const note = opts.note?.trim().slice(0, 500) || null;
  const prefs = opts.preferences && Object.keys(opts.preferences).length ? opts.preferences : null;

  const existing = (await sql<SubRow[]>`
    select id, status, confirm_token, confirm_sent_at, wants_alerts, premium_waitlist from subscribers where email = ${email}`)[0];

  const attribution = opts.attribution ?? null;
  await recordEvent({ type: isWaitlist ? "waitlist_signup" : "alert_signup", visitor: opts.visitor ?? null, props: { source: opts.source ?? null, ...(attribution ? { campaign: attribution } : {}) } });

  if (existing && existing.status === "confirmed") {
    await sql`
      update subscribers set
        wants_alerts = wants_alerts or ${!isWaitlist},
        premium_waitlist = premium_waitlist or ${isWaitlist},
        waitlist_joined_at = case when ${isWaitlist} and waitlist_joined_at is null then now() else waitlist_joined_at end,
        waitlist_note = coalesce(${note}, waitlist_note),
        preferences = case when ${prefs !== null} then preferences || ${sql.json(prefs ?? {})} else preferences end,
        attribution = coalesce(attribution, ${attribution ? sql.json(attribution) : null})
      where id = ${existing.id}`;
    return { ok: true, state: "already_confirmed" };
  }

  let confirmToken = existing?.confirm_token ?? token();
  if (existing) {
    // Don't re-send more than once every 5 minutes (protects against abuse).
    const recentlySent = existing.confirm_sent_at && Date.now() - new Date(existing.confirm_sent_at).getTime() < 5 * 60_000;
    if (existing.status === "unsubscribed") confirmToken = token();
    await sql`
      update subscribers set status = 'pending', confirm_token = ${confirmToken},
        wants_alerts = ${existing.status === "unsubscribed" ? !isWaitlist : existing.wants_alerts || !isWaitlist},
        premium_waitlist = ${existing.status === "unsubscribed" ? isWaitlist : existing.premium_waitlist || isWaitlist},
        waitlist_joined_at = case when ${isWaitlist} and waitlist_joined_at is null then now() else waitlist_joined_at end,
        waitlist_note = coalesce(${note}, waitlist_note),
        preferences = case when ${prefs !== null} then preferences || ${sql.json(prefs ?? {})} else preferences end,
        unsubscribed_at = null,
        attribution = coalesce(attribution, ${attribution ? sql.json(attribution) : null})
      where id = ${existing.id}`;
    if (recentlySent && existing.status === "pending") return { ok: true, state: "check_email" };
  } else {
    await sql`
      insert into subscribers (email, status, wants_alerts, premium_waitlist, waitlist_note, preferences, confirm_token, unsubscribe_token, source, waitlist_joined_at, attribution)
      values (${email}, 'pending', ${!isWaitlist}, ${isWaitlist}, ${note}, ${sql.json(prefs ?? {})}, ${confirmToken}, ${token()}, ${opts.source ?? null},
              ${isWaitlist ? new Date() : null}, ${attribution ? sql.json(attribution) : null})
      on conflict (email) do nothing`;
  }

  const row = (await sql<SubRow[]>`select id, status, confirm_token, confirm_sent_at, wants_alerts, premium_waitlist from subscribers where email = ${email}`)[0];
  const confirmUrl = absoluteUrl(`/alerts/confirm?token=${encodeURIComponent(row.confirm_token ?? confirmToken)}`);
  const msg = confirmationEmail({ confirmUrl, waitlist: row.premium_waitlist, alerts: row.wants_alerts });
  const sent = await sendEmail({ to: email, ...msg });
  await sql`update subscribers set confirm_sent_at = now() where id = ${row.id}`;
  if (sent.skipped) return { ok: true, state: "email_not_configured" };
  if (!sent.ok) return { ok: false, error: "We couldn't send the confirmation email. Please try again in a few minutes." };
  return { ok: true, state: "check_email" };
}

export async function findByConfirmToken(t: string) {
  if (!t || t.length > 100) return null;
  return (await sql<{ id: number; email: string; status: string }[]>`select id, email, status from subscribers where confirm_token = ${t}`)[0] ?? null;
}

export async function confirmSubscriber(t: string): Promise<boolean> {
  const rows = await sql`
    update subscribers set status = 'confirmed', confirmed_at = now(), confirm_token = null
    where confirm_token = ${t} and status = 'pending' returning id`;
  if (rows.length) await recordEvent({ type: "alert_confirmed" });
  return rows.length === 1;
}

export async function findByUnsubscribeToken(t: string) {
  if (!t || t.length > 100) return null;
  return (await sql<{ id: number; email: string; status: string }[]>`select id, email, status from subscribers where unsubscribe_token = ${t}`)[0] ?? null;
}

export async function unsubscribe(t: string): Promise<boolean> {
  const rows = await sql`
    update subscribers set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null
    where unsubscribe_token = ${t} and status <> 'unsubscribed' returning id`;
  return rows.length === 1;
}
