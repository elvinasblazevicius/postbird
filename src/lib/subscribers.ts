import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/site";
import { recordEvent } from "@/lib/analytics";

export type SignupKind = "alerts" | "waitlist";

export type SignupResult =
  | { ok: true; state: "check_email" | "email_not_configured" }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const token = () => randomBytes(24).toString("base64url");

type SubRow = { id: number; status: string; confirm_token: string | null; confirm_sent_at: Date | null; wants_alerts: boolean; premium_waitlist: boolean };

/**
 * Double opt-in sign-up. New addresses are stored as "pending". For an
 * address that already exists, the requested changes are only stored as
 * pending and applied when the owner clicks the confirmation link, so nobody
 * can change someone else's subscription. The reply is the same either way,
 * so the form can't be used to find out who is subscribed.
 */
export async function signup(opts: { email: string; kind: SignupKind; source?: string; note?: string; preferences?: Record<string, string>; attribution?: Record<string, string> | null; visitor?: string | null }): Promise<SignupResult> {
  const email = normalizeEmail(opts.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  const isWaitlist = opts.kind === "waitlist";
  const note = opts.note?.trim().slice(0, 500) || null;
  const prefs = opts.preferences && Object.keys(opts.preferences).length ? opts.preferences : null;
  const attribution = opts.attribution ?? null;

  await recordEvent({ type: isWaitlist ? "waitlist_signup" : "alert_signup", visitor: opts.visitor ?? null, props: { source: opts.source ?? null, ...(attribution ? { campaign: attribution } : {}) } });

  const existing = (await sql<SubRow[]>`
    select id, status, confirm_token, confirm_sent_at, wants_alerts, premium_waitlist from subscribers where email = ${email}`)[0];

  if (existing) {
    const change = { wants_alerts: !isWaitlist, premium_waitlist: isWaitlist, note, preferences: prefs ?? {} };
    const confirmToken = existing.confirm_token ?? token();
    await sql`
      update subscribers set
        confirm_token = ${confirmToken},
        pending_changes = jsonb_build_object(
          'wants_alerts', coalesce((pending_changes->>'wants_alerts')::boolean, false) or ${change.wants_alerts},
          'premium_waitlist', coalesce((pending_changes->>'premium_waitlist')::boolean, false) or ${change.premium_waitlist},
          'note', coalesce(${note}::text, pending_changes->>'note'),
          'preferences', coalesce(pending_changes->'preferences', '{}'::jsonb) || ${sql.json(change.preferences)}
        ),
        attribution = coalesce(attribution, ${attribution ? sql.json(attribution) : null})
      where id = ${existing.id}`;
    // Don't send more than one confirmation email every 5 minutes (protects against abuse).
    const recentlySent = existing.confirm_sent_at && Date.now() - new Date(existing.confirm_sent_at).getTime() < 5 * 60_000;
    if (recentlySent) return { ok: true, state: isEmailConfigured() ? "check_email" : "email_not_configured" };
    return sendConfirmation(existing.id, email, confirmToken, existing.premium_waitlist || isWaitlist, existing.wants_alerts || !isWaitlist);
  }

  const confirmToken = token();
  const [row] = await sql<{ id: number }[]>`
    insert into subscribers (email, status, wants_alerts, premium_waitlist, waitlist_note, preferences, confirm_token, unsubscribe_token, source, waitlist_joined_at, attribution)
    values (${email}, 'pending', ${!isWaitlist}, ${isWaitlist}, ${note}, ${sql.json(prefs ?? {})}, ${confirmToken}, ${token()}, ${opts.source ?? null},
            ${isWaitlist ? new Date() : null}, ${attribution ? sql.json(attribution) : null})
    on conflict (email) do nothing
    returning id`;
  if (!row) return { ok: true, state: isEmailConfigured() ? "check_email" : "email_not_configured" }; // created at the same moment by another request
  return sendConfirmation(row.id, email, confirmToken, isWaitlist, !isWaitlist);
}

async function sendConfirmation(id: number, email: string, confirmToken: string, waitlist: boolean, alerts: boolean): Promise<SignupResult> {
  const confirmUrl = absoluteUrl(`/alerts/confirm?token=${encodeURIComponent(confirmToken)}`);
  const sent = await sendEmail({ to: email, ...confirmationEmail({ confirmUrl, waitlist, alerts }) });
  await sql`update subscribers set confirm_sent_at = now() where id = ${id}`;
  if (sent.skipped) return { ok: true, state: "email_not_configured" };
  if (!sent.ok) return { ok: false, error: "We couldn't send the confirmation email. Please try again in a few minutes." };
  return { ok: true, state: "check_email" };
}

export async function findByConfirmToken(t: string) {
  if (!t || t.length > 100) return null;
  return (await sql<{ id: number; email: string; status: string }[]>`select id, email, status from subscribers where confirm_token = ${t}`)[0] ?? null;
}

/** Confirms the address and applies any changes that were waiting for confirmation. */
export async function confirmSubscriber(t: string): Promise<boolean> {
  if (!t || t.length > 100) return false;
  const rows = await sql`
    update subscribers set
      wants_alerts = case when status = 'unsubscribed' then coalesce((pending_changes->>'wants_alerts')::boolean, wants_alerts)
                          else wants_alerts or coalesce((pending_changes->>'wants_alerts')::boolean, false) end,
      premium_waitlist = case when status = 'unsubscribed' then coalesce((pending_changes->>'premium_waitlist')::boolean, premium_waitlist)
                              else premium_waitlist or coalesce((pending_changes->>'premium_waitlist')::boolean, false) end,
      waitlist_joined_at = case when coalesce((pending_changes->>'premium_waitlist')::boolean, false) and waitlist_joined_at is null then now() else waitlist_joined_at end,
      waitlist_note = coalesce(pending_changes->>'note', waitlist_note),
      preferences = preferences || coalesce(pending_changes->'preferences', '{}'::jsonb),
      pending_changes = null,
      status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      unsubscribed_at = null,
      confirm_token = null
    where confirm_token = ${t}
    returning id`;
  if (rows.length) await recordEvent({ type: "alert_confirmed" });
  return rows.length === 1;
}

export async function findByUnsubscribeToken(t: string) {
  if (!t || t.length > 100) return null;
  return (await sql<{ id: number; email: string; status: string }[]>`select id, email, status from subscribers where unsubscribe_token = ${t}`)[0] ?? null;
}

export async function unsubscribe(t: string): Promise<boolean> {
  const rows = await sql`
    update subscribers set status = 'unsubscribed', unsubscribed_at = now(), confirm_token = null, pending_changes = null
    where unsubscribe_token = ${t} and status <> 'unsubscribed' returning id`;
  return rows.length === 1;
}
