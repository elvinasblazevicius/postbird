"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ALL_CATEGORIES } from "@/config/categories";
import { IMPORT_SETTINGS } from "@/config/import";
import { ADMIN_COOKIE, checkPassword, createAdminSession, isAdminConfigured, revokeAllSessions, verifyAdminSession } from "@/lib/admin-auth";
import { sql, transaction, type Db } from "@/lib/db";
import { batchKey, isEmailConfigured, sendBatch, sendEmail, type OutgoingEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/email-templates";
import { parseFeed } from "@/lib/feeds/parse";
import { clientIp, hashKey, rateLimit } from "@/lib/rate-limit";
import { absoluteUrl, parseId } from "@/lib/site";
import { requireAdmin } from "./guard";
import siteConfig from "@site-config";

// The sync and digest modules (and the HTML sanitizer they pull in) are
// imported only inside the actions that need them, after the admin check, so
// the login page never depends on them.
const loadSync = () => import("@/lib/feeds/sync");

export type AdminState = { ok: boolean; message: string } | null;

// ── Auth ──
const LOCK_MINUTES = 15;
const MAX_FAILURES_PER_IP = 8; // per 15 minutes
// No limit across all connections: it would let anyone lock the owner out by
// guessing from many addresses. The per-connection limits, the delay and a
// long password are the protection.

export async function loginAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  if (!isAdminConfigured()) {
    return { ok: false, message: "Admin login isn't set up. Add ADMIN_PASSWORD (10+ characters) and CRON_SECRET (16+ characters) to the environment variables." };
  }
  await new Promise((r) => setTimeout(r, 400)); // slows down password guessing
  const ip = clientIp(await headers());
  // Stored as a salted hash, never the IP itself; rows are deleted after 24 hours.
  const who = hashKey(`admin-login|${ip}`);
  const locked = { ok: false, message: `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.` };
  if (!(await rateLimit(`admin-login|${ip}`, 30, LOCK_MINUTES * 60))) return locked;
  const [{ mine }] = await sql<{ mine: number }[]>`
    select count(*)::int as mine from admin_login_failures
    where who = ${who} and at > now() - make_interval(mins => ${LOCK_MINUTES})`;
  if (mine >= MAX_FAILURES_PER_IP) return locked;
  if (!checkPassword(String(form.get("password") ?? ""))) {
    await sql`insert into admin_login_failures (who) values (${who})`;
    await sql`delete from admin_login_failures where at < now() - interval '24 hours'`;
    return { ok: false, message: "That password isn't correct." };
  }
  const session = await createAdminSession();
  (await cookies()).set(ADMIN_COOKIE, session.value, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge,
  });
  redirect("/admin");
}

/** Signing out ends every admin session (on every device). */
export async function logoutAction() {
  const jar = await cookies();
  // Only a signed-in admin may end all sessions; anyone else just loses their cookie.
  if (await verifyAdminSession(jar.get(ADMIN_COOKIE)?.value)) await revokeAllSessions();
  jar.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

// ── Feeds ──
const POLICIES = ["none", "excerpt", "full"] as const;

export async function addFeedAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();
  const url = String(form.get("url") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || "Untitled feed";
  const org = String(form.get("default_organization") ?? "").trim().slice(0, 120) || null;
  const policyRaw = String(form.get("content_policy") ?? IMPORT_SETTINGS.defaultContentPolicy);
  const policy = (POLICIES as readonly string[]).includes(policyRaw) ? policyRaw : "none";
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, message: "Enter a full feed address starting with https://" };

  // Check the feed before saving it, so typos are caught immediately.
  let note = "";
  try {
    const { fetchFeedText } = await loadSync();
    const parsed = parseFeed(await fetchFeedText(url, 7_000)); // stays within the host time limit
    note = ` It currently has ${parsed.items.length} items.`;
  } catch (e) {
    return { ok: false, message: `Couldn't read that feed: ${(e as Error).message}` };
  }
  const rows = await sql`
    insert into feeds (name, url, default_organization, content_policy) values (${name}, ${url}, ${org}, ${policy})
    on conflict (url) do nothing returning id`;
  revalidatePath("/admin/feeds");
  if (!rows.length) return { ok: false, message: "That feed is already in the list." };
  return { ok: true, message: `Feed added.${note} Run a sync to import it now.` };
}

export async function updateFeedAction(form: FormData) {
  await requireAdmin();
  const id = parseId(form.get("id"));
  if (id === null) return;
  const policyRaw = String(form.get("content_policy") ?? "none");
  const policy = (POLICIES as readonly string[]).includes(policyRaw) ? policyRaw : "none";
  const active = form.get("is_active") === "on";
  await transaction(async (tx) => {
    await tx`
      update feeds set name = ${String(form.get("name") ?? "").trim().slice(0, 120) || "Untitled feed"},
        default_organization = ${String(form.get("default_organization") ?? "").trim().slice(0, 120) || null},
        content_policy = ${policy}, is_active = ${active}, updated_at = now()
      where id = ${id}`;
    if (!active) await releaseFeedJobs(tx, id);
  });
  revalidatePath("/admin/feeds");
}

/**
 * A switched-off or deleted feed no longer supplies its listings' data: the
 * next feed that still lists them takes them over (see primary_feed_id in
 * src/lib/feeds/sync.ts).
 */
async function releaseFeedJobs(db: Db, feedId: number) {
  await db`update jobs set primary_feed_id = null where primary_feed_id = ${feedId}`;
}

export async function deleteFeedAction(form: FormData) {
  await requireAdmin();
  const id = parseId(form.get("id"));
  if (id === null) return;
  const [feed] = await sql<{ from_env: boolean }[]>`select from_env from feeds where id = ${id}`;
  if (!feed) return;
  await transaction(async (tx) => {
    if (feed.from_env) {
      // It would come back from INOREADER_FEED_URLS on the next sync, so switch it off instead.
      await tx`update feeds set is_active = false, updated_at = now() where id = ${id}`;
    } else {
      await tx`delete from feeds where id = ${id}`;
    }
    await releaseFeedJobs(tx, id);
  });
  revalidatePath("/admin/feeds");
}

// ── Sync ──
export async function syncNowAction(): Promise<void> {
  await requireAdmin();
  const { runSync } = await loadSync();
  const result = await runSync("manual");
  revalidatePath("/admin", "layout");
  redirect(`/admin/imports/${result.runId}`);
}

// ── Jobs ──
export async function setJobStatusAction(form: FormData) {
  await requireAdmin();
  const id = parseId(form.get("id"));
  if (id === null) return;
  const op = String(form.get("op"));
  if (op === "remove") {
    await sql`update jobs set status = 'removed', removed_reason = ${String(form.get("reason") ?? "").slice(0, 200) || "Removed by admin"}, updated_at = now() where id = ${id}`;
  } else if (op === "restore") {
    await sql`
      update jobs set status = case when deadline is not null and deadline < (now() at time zone 'utc')::date then 'expired' else 'active' end,
        removed_reason = null, updated_at = now()
      where id = ${id} and status = 'removed'`;
  }
  revalidatePath("/admin/jobs");
}

export async function setJobCategoryAction(form: FormData) {
  await requireAdmin();
  const id = parseId(form.get("id"));
  if (id === null) return;
  const cat = String(form.get("category"));
  if (!ALL_CATEGORIES.some((c) => c.slug === cat)) return;
  await sql`update jobs set category = ${cat}, category_locked = true, updated_at = now() where id = ${id}`;
  revalidatePath("/admin/jobs");
}

// ── Subscribers ──
/** Sends one test email to the site's contact address and shows Resend's answer on the overview. */
export async function sendTestEmailAction(): Promise<void> {
  await requireAdmin();
  const to = siteConfig.contactEmail;
  const res = await sendEmail({
    to,
    subject: `${siteConfig.name} test email`,
    text: `This is a test email from the ${siteConfig.name} admin overview. If you can read it, sending works.`,
    html: `<p>This is a test email from the ${siteConfig.name} admin overview. If you can read it, sending works.</p>`,
  });
  const result = res.ok ? `sent to ${to}` : `not sent: ${res.error ?? "unknown error"}`;
  redirect(`/admin?email=${encodeURIComponent(result.slice(0, 200))}`);
}

/** Confirmation emails resent per click: one Resend batch request, well within the host's time limit. */
const RESEND_CONFIRMATIONS_LIMIT = 100;

export async function resendConfirmationsAction(): Promise<void> {
  await requireAdmin();
  if (!isEmailConfigured()) redirect("/admin/subscribers?msg=email-not-configured");
  // Claim the rows first (confirm_sent_at), so a second click at the same time can't send them too.
  const pending = await sql<{ id: number; email: string; confirm_token: string; wants_alerts: boolean; premium_waitlist: boolean; prev_sent_at: Date | null }[]>`
    update subscribers s set confirm_sent_at = now()
    from (
      select id, confirm_sent_at as prev_sent_at from subscribers
      where status = 'pending' and confirm_token is not null and (confirm_sent_at is null or confirm_sent_at < now() - interval '1 hour')
      order by id limit ${RESEND_CONFIRMATIONS_LIMIT}
      for update skip locked
    ) p
    where s.id = p.id
    returning s.id::int as id, s.email, s.confirm_token, s.wants_alerts, s.premium_waitlist, p.prev_sent_at`;
  let sent = 0, failed = 0;
  if (pending.length) {
    // One key per batch from each message's key (subscriber and hour): a repeated
    // request within the hour can't send twice; a click an hour later sends again.
    const hour = new Date().toISOString().slice(0, 13);
    const msgs: OutgoingEmail[] = pending.map((p) => ({
      to: p.email,
      ...confirmationEmail({ confirmUrl: absoluteUrl(`/alerts/confirm?token=${encodeURIComponent(p.confirm_token)}`), waitlist: p.premium_waitlist, alerts: p.wants_alerts }),
      idempotencyKey: `confirm-resend:${p.id}:${hour}`,
    }));
    const res = await sendBatch(msgs, () => batchKey("confirm-resend", pending.map((p) => `confirm-resend:${p.id}:${hour}`)));
    sent = res.sent;
    failed = res.failed;
    // Not sent: give those rows back (their previous send time) for the next click.
    for (const [j, p] of pending.entries()) {
      if (!res.delivered[j]) await sql`update subscribers set confirm_sent_at = ${p.prev_sent_at} where id = ${p.id}`;
    }
  }
  const [{ remaining }] = await sql<{ remaining: number }[]>`
    select count(*)::int as remaining from subscribers
    where status = 'pending' and confirm_token is not null and (confirm_sent_at is null or confirm_sent_at < now() - interval '1 hour')`;
  const message = `Confirmation emails: sent ${sent}${failed ? `, ${failed} not sent (try again later)` : ""}.${remaining && !failed ? ` ${remaining} still waiting: click again.` : ""}`;
  redirect(`/admin/subscribers?msg=${encodeURIComponent(message)}`);
}

export async function sendDigestNowAction(): Promise<void> {
  await requireAdmin();
  const { runDigest } = await import("@/lib/digest");
  // Any day of the week; still at most one weekly email per subscriber per week.
  const r = await runDigest({ force: true });
  redirect(`/admin/subscribers?msg=${encodeURIComponent(`weekly email: ${r.status}${r.message ? ` — ${r.message}` : ` — sent ${r.sent} of ${r.recipients} (${r.empty} had no new matches)`}`)}`);
}

/**
 * "Email the early-access list: alerts are open": the one email promised to
 * the early-access list (src/lib/billing/notices.ts → notifyWaitlist). Needs
 * the confirmation tick box; sends up to 300 per click.
 */
export async function notifyWaitlistAction(form: FormData): Promise<void> {
  await requireAdmin();
  if (!isEmailConfigured()) redirect("/admin/subscribers?msg=email-not-configured");
  if (form.get("confirm") !== "on") redirect(`/admin/subscribers?msg=${encodeURIComponent("Tick the box to confirm, then click again.")}`);
  const { notifyWaitlist } = await import("@/lib/billing/notices");
  const r = await notifyWaitlist();
  redirect(`/admin/subscribers?msg=${encodeURIComponent(`Early access email: ${r.message}`)}`);
}

// ── Billing ──
export type SelfCheckState = { checked: boolean; items: { name: string; ok: boolean; detail: string }[] };

/**
 * "Billing self-check": two harmless reads with the Paddle API key (the monthly
 * price and one customer) that show which permission is missing, if any.
 */
export async function billingSelfCheckAction(): Promise<SelfCheckState> {
  await requireAdmin();
  const { billingSelfCheck } = await import("@/lib/billing/paddle");
  const { PADDLE_PRICE_MONTHLY } = await import("@/lib/billing/live");
  return { checked: true, items: await billingSelfCheck(PADDLE_PRICE_MONTHLY) };
}

/** Marks a billing flag (Admin → Overview) as dealt with. */
export async function resolveBillingFlagAction(form: FormData): Promise<void> {
  await requireAdmin();
  const subscriptionId = String(form.get("subscription_id") ?? "").slice(0, 100);
  const kind = String(form.get("kind") ?? "");
  if (/^sub_[a-z\d]{26}$/.test(subscriptionId) && ["trial_blocked", "customer_mismatch", "customer_unverified"].includes(kind)) {
    await sql`update billing_flags set resolved_at = now(), updated_at = now() where subscription_id = ${subscriptionId} and kind = ${kind} and resolved_at is null`;
  }
  revalidatePath("/admin");
  redirect("/admin");
}

/** Marks an unexpected error (Admin → Overview → Errors to look at) as dealt with. */
export async function resolveOpsEventAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = parseId(String(form.get("id") ?? ""));
  if (id) {
    const { resolveOpsEvent } = await import("@/lib/ops-events");
    await resolveOpsEvent(id);
  }
  revalidatePath("/admin");
  redirect("/admin");
}
