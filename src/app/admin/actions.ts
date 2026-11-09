"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ALL_CATEGORIES } from "@/config/categories";
import { IMPORT_SETTINGS } from "@/config/import";
import { ADMIN_COOKIE, checkPassword, createAdminSession, isAdminConfigured, revokeAllSessions, verifyAdminSession } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { confirmationEmail } from "@/lib/email-templates";
import { parseFeed } from "@/lib/feeds/parse";
import { clientIp, hashKey, rateLimit } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/site";
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
const MAX_FAILURES_GLOBAL = 50; // from all sources per 15 minutes; above this every sign-in is refused

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
  const [{ mine, total }] = await sql<{ mine: number; total: number }[]>`
    select count(*) filter (where who = ${who})::int as mine, count(*)::int as total
    from admin_login_failures where at > now() - make_interval(mins => ${LOCK_MINUTES})`;
  if (mine >= MAX_FAILURES_PER_IP) return locked;
  if (total > MAX_FAILURES_GLOBAL) {
    console.warn(`admin login: more than ${MAX_FAILURES_GLOBAL} wrong passwords in ${LOCK_MINUTES} minutes; sign-in is paused`);
    return { ok: false, message: `Sign-in is paused for ${LOCK_MINUTES} minutes after many wrong passwords. Try again later.` };
  }
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
  const id = Number(form.get("id"));
  const policyRaw = String(form.get("content_policy") ?? "none");
  const policy = (POLICIES as readonly string[]).includes(policyRaw) ? policyRaw : "none";
  await sql`
    update feeds set name = ${String(form.get("name") ?? "").trim().slice(0, 120) || "Untitled feed"},
      default_organization = ${String(form.get("default_organization") ?? "").trim().slice(0, 120) || null},
      content_policy = ${policy}, is_active = ${form.get("is_active") === "on"}, updated_at = now()
    where id = ${id}`;
  revalidatePath("/admin/feeds");
}

export async function deleteFeedAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("id"));
  const [feed] = await sql<{ from_env: boolean }[]>`select from_env from feeds where id = ${id}`;
  if (!feed) return;
  if (feed.from_env) {
    // It would come back from INOREADER_FEED_URLS on the next sync, so switch it off instead.
    await sql`update feeds set is_active = false, updated_at = now() where id = ${id}`;
  } else {
    await sql`delete from feeds where id = ${id}`;
  }
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
  const id = Number(form.get("id"));
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
  const id = Number(form.get("id"));
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

export async function resendConfirmationsAction(): Promise<void> {
  await requireAdmin();
  if (!isEmailConfigured()) redirect("/admin/subscribers?msg=email-not-configured");
  const pending = await sql<{ id: number; email: string; confirm_token: string; wants_alerts: boolean; premium_waitlist: boolean }[]>`
    select id, email, confirm_token, wants_alerts, premium_waitlist from subscribers
    where status = 'pending' and confirm_token is not null and (confirm_sent_at is null or confirm_sent_at < now() - interval '1 hour')
    order by id limit 90`;
  let sent = 0;
  for (const p of pending) {
    const msg = confirmationEmail({ confirmUrl: absoluteUrl(`/alerts/confirm?token=${encodeURIComponent(p.confirm_token)}`), waitlist: p.premium_waitlist, alerts: p.wants_alerts });
    const res = await sendEmail({ to: p.email, ...msg });
    if (res.ok) {
      sent++;
      await sql`update subscribers set confirm_sent_at = now() where id = ${p.id}`;
    }
  }
  redirect(`/admin/subscribers?msg=confirmations-sent-${sent}`);
}

export async function sendDigestNowAction(): Promise<void> {
  await requireAdmin();
  const { runDigest } = await import("@/lib/digest");
  const r = await runDigest();
  redirect(`/admin/subscribers?msg=${encodeURIComponent(`digest: ${r.status}${r.message ? ` — ${r.message}` : ` — sent ${r.sent} of ${r.recipients}`}`)}`);
}
