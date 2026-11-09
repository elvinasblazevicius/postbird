import siteConfig from "@site-config";
import type { JobListItem } from "@/lib/jobs";
import { BILLING_LIVE } from "@/lib/billing/live";
import { EMAIL_TAX_NOTE, planDescription } from "@/lib/early-access-copy";
import { displayGrade } from "@/lib/grades";
import { absoluteUrl, formatDate, jobPath, locationLabel, NOT_SPECIFIED } from "@/lib/site";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string, footerHtml: string): string {
  const brand = siteConfig.colors.brand;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f4f6f9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0e1b2c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dde3ea;border-radius:12px">
<tr><td style="padding:22px 28px;border-bottom:1px solid #dde3ea;font-family:Georgia,serif;font-size:20px;font-weight:600;color:${brand}">${esc(siteConfig.name)}</td></tr>
<tr><td style="padding:28px">${bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #dde3ea;font-size:12px;line-height:1.6;color:#566476">${footerHtml}<br>${esc(postal())}</td></tr>
</table></td></tr></table></body></html>`;
}

const postal = () => `${siteConfig.name} is run by ${siteConfig.operator.name}, ${siteConfig.operator.address}.`;

function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${siteConfig.colors.brand};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(label)}</a>`;
}

export function confirmationEmail(opts: { confirmUrl: string; waitlist: boolean; alerts: boolean }) {
  const what = opts.alerts && opts.waitlist
    ? "the free weekly email with new vacancies, and early access to paid email alerts"
    : opts.waitlist
      ? "early access to paid email alerts (one email when they open; nothing is charged)"
      : "the free weekly email with new vacancies (sent on Mondays, only when there is something new for your search)";
  const subject = `Confirm your email for ${siteConfig.name}`;
  const html = layout(
    subject,
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Please confirm your email to get ${esc(what)}.</p>
     <p style="margin:0 0 20px">${button(opts.confirmUrl, "Confirm my email")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">If you didn't sign up, ignore this email and you won't hear from us again.</p>`,
    `You received this because this address was entered on ${esc(siteConfig.name)}.`,
  );
  const text = `Please confirm your email to get ${what}.\n\nConfirm: ${opts.confirmUrl}\n\nIf you didn't sign up, ignore this email.\n\n${postal()}`;
  return { subject, html, text };
}

// ── Job lists in alert emails ────────────────────────────────

export type AlertGroup = { label: string; url: string; jobs: JobListItem[]; total: number };

/**
 * At most this many vacancies are listed in one email, across all its searches: Gmail clips
 * messages over 102 KB of HTML and hides what comes after, including the unsubscribe link.
 */
export const MAX_JOBS_PER_EMAIL = 50;

/**
 * Keeps at most `max` listed vacancies across the groups, in order: later searches get fewer
 * (possibly none). Each group keeps its total, so its "See all N" link still shows.
 */
export function capGroups(groups: AlertGroup[], max = MAX_JOBS_PER_EMAIL): AlertGroup[] {
  let left = max;
  return groups.map((g) => {
    const jobs = g.jobs.slice(0, Math.max(0, left));
    left -= jobs.length;
    return { ...g, jobs };
  });
}

/** "UNICEF · Nairobi, Kenya · P-3 · Closes 30 Nov 2026": what is known, nothing guessed. */
function jobMeta(j: JobListItem): string {
  const where = locationLabel(j);
  return [
    j.org_name ?? "Organization not in our source",
    where === NOT_SPECIFIED ? null : where,
    displayGrade(j),
    j.deadline ? `Closes ${formatDate(j.deadline)}` : null,
  ].filter(Boolean).join(" · ");
}

/** One compact row per vacancy (kept small so a full email stays well under Gmail's clipping size). */
function jobRowsHtml(jobs: JobListItem[], utm: string): string {
  if (!jobs.length) return "";
  const rows = jobs
    .map((j) => `<tr><td style="padding:8px 0;border-bottom:1px solid #dde3ea"><a href="${esc(absoluteUrl(jobPath(j)) + utm)}" style="font-size:15px;font-weight:600;color:#0e1b2c;text-decoration:none">${esc(j.title)}</a><br><span style="font-size:13px;color:#566476">${esc(jobMeta(j))}</span></td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

const jobRowsText = (jobs: JobListItem[]) => jobs.map((j) => `${j.title}\n${jobMeta(j)}\n${absoluteUrl(jobPath(j))}`).join("\n\n");

/**
 * The free weekly email: the new matches for the subscriber's one search (the
 * caller lists at most 10), with "See all" when there are more. One calm line
 * offers daily alerts (the free trial once billing is live, early access before).
 */
export function weeklyEmail(opts: { group: AlertGroup; search: string; trialUrl: string; accountUrl: string; unsubscribeUrl: string }) {
  const all = opts.search === "";
  const g = capGroups([opts.group])[0];
  const subject = all
    ? `${g.total} new international ${g.total === 1 ? "vacancy" : "vacancies"} this week`
    : `${g.total} new ${g.total === 1 ? "vacancy matches" : "vacancies match"} your search this week`;
  const rows = jobRowsHtml(g.jobs, "?utm_source=digest&utm_medium=email");
  const more = g.total > g.jobs.length
    ? `<p style="margin:20px 0 0">${button(g.url, `See all ${g.total} new vacancies`)}</p>`
    : "";
  const p = siteConfig.premium;
  const upsell = BILLING_LIVE
    ? { lead: "Want new matches every day, with up to 5 searches?", link: `Start a ${p.trialDays}-day free trial` }
    : { lead: "Daily alerts with up to 5 searches are coming.", link: "Join early access" };
  const intro = all ? "The newest vacancies of the past week." : `New this week for your search: ${g.label}.`;
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 6px">This week's new vacancies</h1>
     <p style="font-size:15px;color:#566476;margin:0 0 10px">${esc(intro)} Apply on each employer's own website.</p>
     ${rows}${more}
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:24px 0 0">${esc(upsell.lead)} <a href="${esc(opts.trialUrl)}" style="color:${siteConfig.colors.accent};font-weight:600">${esc(upsell.link)}</a></p>`,
    `${esc(siteConfig.disclaimer)}<br><br>You get this free weekly email because you signed up on ${esc(siteConfig.name)}.
    <a href="${esc(opts.accountUrl)}" style="color:#566476">Change your search</a> &nbsp;|&nbsp; <a href="${esc(opts.unsubscribeUrl)}" style="color:#566476">Unsubscribe</a>`,
  );
  const text =
    `This week's new vacancies on ${siteConfig.name}\n${intro}\n\n` +
    jobRowsText(g.jobs) +
    (g.total > g.jobs.length ? `\n\nSee all ${g.total}: ${g.url}` : "") +
    `\n\n${upsell.lead} ${upsell.link}: ${opts.trialUrl}` +
    `\n\nChange your search: ${opts.accountUrl}\nUnsubscribe: ${opts.unsubscribeUrl}\n\n${postal()}`;
  return { subject, html, text };
}

// ── Paid email alerts ────────────────────────────────────────

/** Footer of every paid-alert email: the account link and the unsubscribe link (the postal line is added by layout()). */
function accountFooter(accountUrl: string, unsubscribeUrl: string): string {
  return `${esc(siteConfig.disclaimer)}<br><br><a href="${esc(accountUrl)}" style="color:#566476">Your account</a>: saved searches, daily or weekly, billing.
    &nbsp;|&nbsp; <a href="${esc(unsubscribeUrl)}" style="color:#566476">Unsubscribe</a> from these emails.`;
}

const accountFooterText = (accountUrl: string, unsubscribeUrl: string) =>
  `Your account (saved searches, frequency, billing): ${accountUrl}\nUnsubscribe: ${unsubscribeUrl}\n\n${postal()}`;

/**
 * What the subscriber will be charged: their plan's price when `plan` is one of the plan
 * descriptions (planDescription), otherwise both plans, neutrally.
 */
function chargeLine(plan: string): string {
  const [m, q] = siteConfig.premium.plans;
  if (plan === planDescription("quarter")) return `${q.price} every ${q.per}`;
  if (plan === planDescription("month")) return `${m.price} every ${m.per}`;
  return `the price of the plan you chose (${m.price} every ${m.per} or ${q.price} every ${q.per})`;
}

/** Sent once when a subscriber's trial (or subscription) starts. `plan` is planDescription() of their plan. */
export function welcomeEmail(opts: { accountUrl: string; unsubscribeUrl: string; trialEndsAt: string | null; plan: string }) {
  const subject = `Your ${siteConfig.name} ${siteConfig.premium.name.toLowerCase()} are on`;
  const refundsUrl = absoluteUrl("/refunds");
  const charge = chargeLine(opts.plan);
  const trial = opts.trialEndsAt
    ? `Your free trial runs until ${formatDate(opts.trialEndsAt)}. After your trial you're charged ${charge} ${EMAIL_TAX_NOTE}, renewing automatically until you cancel. Cancel any time from your account page.`
    : `You're charged ${charge} ${EMAIL_TAX_NOTE}, renewing automatically until you cancel. Cancel any time from your account page.`;
  const refundHtml = `Refund policy: <a href="${esc(refundsUrl)}" style="color:#566476">${esc(refundsUrl)}</a>`;
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 12px">Welcome to ${esc(siteConfig.premium.name.toLowerCase())}</h1>
     <p style="font-size:16px;line-height:1.6;margin:0 0 12px">We'll email you new vacancies that match your saved searches. Your first alert arrives with the next round of new listings.</p>
     <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#566476">${esc(trial)} ${refundHtml}</p>
     <p style="margin:0 0 20px">${button(opts.accountUrl, "Open my account")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">On your account page you can add up to 5 saved searches, choose daily or weekly emails, and manage billing. Keep this email: the button is your private link.</p>`,
    accountFooter(opts.accountUrl, opts.unsubscribeUrl),
  );
  const text = `Welcome to ${siteConfig.premium.name.toLowerCase()} on ${siteConfig.name}.\n\nWe'll email you new vacancies that match your saved searches.\n\n${trial} Refund policy: ${refundsUrl}\n\nYour account (keep this link private): ${opts.accountUrl}\n\n${accountFooterText(opts.accountUrl, opts.unsubscribeUrl)}`;
  return { subject, html, text };
}

/** "Email me my account link" (sent only to the address itself). */
export function accountLinkEmail(opts: { accountUrl: string; unsubscribeUrl: string }) {
  const subject = `Your ${siteConfig.name} account link`;
  const html = layout(
    subject,
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Here is the link to your ${esc(siteConfig.name)} account, where you can change your saved searches, choose daily or weekly emails and, if you have a plan, cancel it or manage billing (&ldquo;Cancel or manage billing&rdquo;).</p>
     <p style="margin:0 0 20px">${button(opts.accountUrl, "Open my account")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">This is a new link: account links in older emails no longer work. If you didn't ask for this, you can ignore this email; the link only works for this address.</p>`,
    accountFooter(opts.accountUrl, opts.unsubscribeUrl),
  );
  const text = `Your ${siteConfig.name} account: ${opts.accountUrl}\n\nThere you can change your saved searches, choose daily or weekly emails and, if you have a plan, cancel it or manage billing ("Cancel or manage billing").\n\nThis is a new link: account links in older emails no longer work. If you didn't ask for this, ignore this email.\n\n${accountFooterText(opts.accountUrl, opts.unsubscribeUrl)}`;
  return { subject, html, text };
}

/**
 * One email per subscriber with the new matches for each saved search (the caller lists up to
 * 20 per search). At most MAX_JOBS_PER_EMAIL are listed in all; every search keeps its "See all".
 */
export function alertEmail(opts: { groups: AlertGroup[]; frequency: "daily" | "weekly"; accountUrl: string; unsubscribeUrl: string }) {
  const groups = capGroups(opts.groups);
  const total = groups.reduce((n, g) => n + g.total, 0);
  const subject = `${total} new ${total === 1 ? "vacancy matches" : "vacancies match"} your ${groups.length === 1 ? "search" : "searches"}`;
  const sections = groups
    .map((g) => {
      const more = g.total > g.jobs.length
        ? `<p style="margin:10px 0 0"><a href="${esc(g.url)}" style="color:${siteConfig.colors.accent};font-weight:600">See all ${g.total} matches</a></p>`
        : "";
      return `<h2 style="font-size:16px;margin:24px 0 4px;color:#0e1b2c">${esc(g.label)} <span style="font-weight:400;color:#566476">(${g.total} new)</span></h2>${jobRowsHtml(g.jobs, "?utm_source=alert&utm_medium=email")}${more}`;
    })
    .join("");
  const when = opts.frequency === "daily" ? "since yesterday's email" : "since last week's email";
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 6px">New vacancies for your saved searches</h1>
     <p style="font-size:15px;color:#566476;margin:0">New on ${esc(siteConfig.name)} ${when} (or since you saved the search). Apply on each employer's own website.</p>
     ${sections}`,
    accountFooter(opts.accountUrl, opts.unsubscribeUrl),
  );
  const text =
    `New vacancies for your saved searches on ${siteConfig.name}\n\n` +
    groups
      .map((g) => `${g.label} (${g.total} new)\n\n` +
        jobRowsText(g.jobs) +
        (g.total > g.jobs.length ? `${g.jobs.length ? "\n\n" : ""}See all ${g.total}: ${g.url}` : ""))
      .join("\n\n---\n\n") +
    `\n\n${accountFooterText(opts.accountUrl, opts.unsubscribeUrl)}`;
  return { subject, html, text };
}

// ── Plan notices (transactional) ─────────────────────────────
// Sent because the address has a plan, so they go out even after the address
// unsubscribed from alerts; that's why their footer has no unsubscribe link.

const planFooter = (accountUrl: string) =>
  `You're receiving this because this address has a ${esc(siteConfig.name)} ${esc(siteConfig.premium.name.toLowerCase())} plan. It is not a marketing email.
    <br><a href="${esc(accountUrl)}" style="color:#566476">Your account</a>: change searches, manage billing or cancel.`;

const planFooterText = (accountUrl: string) =>
  `You're receiving this because this address has a ${siteConfig.name} ${siteConfig.premium.name.toLowerCase()} plan. Your account: ${accountUrl}\n\n${postal()}`;

/** About 3 days before a free trial turns into the first payment (sent once). */
export function trialReminderEmail(opts: { plan: string; price: string; chargeDate: string; accountUrl: string }) {
  const date = formatDate(opts.chargeDate);
  const subject = `Your ${siteConfig.name} free trial ends on ${date}`;
  const lines = [
    `Your free trial of ${siteConfig.name} ${siteConfig.premium.name.toLowerCase()} ends on ${date}.`,
    `On that day your first payment of ${opts.price} ${EMAIL_TAX_NOTE} is taken for your plan: ${opts.plan}. After that the plan renews automatically until you cancel.`,
    `If you don't want to pay, cancel before ${date} on your account page. If you cancel before then, you pay nothing.`,
  ];
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 12px">Your free trial ends on ${esc(date)}</h1>
     ${lines.map((l) => `<p style="font-size:16px;line-height:1.6;margin:0 0 12px">${esc(l)}</p>`).join("")}
     <p style="margin:8px 0 20px">${button(opts.accountUrl, "Cancel or manage my plan")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">Billing is handled by Paddle, our reseller. Keep this email private: the button is your account link.</p>`,
    planFooter(opts.accountUrl),
  );
  const text = `${lines.join("\n\n")}\n\nCancel or manage your plan: ${opts.accountUrl}\n\n${planFooterText(opts.accountUrl)}`;
  return { subject, html, text };
}

/**
 * After a one-click unsubscribe from an address whose plan is still running:
 * unsubscribing stops emails, not payments.
 */
export function planStillActiveEmail(opts: { renewal: string; accountUrl: string }) {
  const subject = `You've unsubscribed from ${siteConfig.name} alerts`;
  const first = `You've unsubscribed from ${siteConfig.name} alerts. ${opts.renewal}`;
  const html = layout(
    subject,
    `<p style="font-size:16px;line-height:1.6;margin:0 0 12px">${esc(first)}</p>
     <p style="font-size:16px;line-height:1.6;margin:0 0 20px">To stop being charged, cancel here:</p>
     <p style="margin:0 0 20px">${button(opts.accountUrl, "Cancel my plan")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">This is the only email about it. Keep it private: the button is your account link.</p>`,
    planFooter(opts.accountUrl),
  );
  const text = `${first}\n\nTo stop being charged, cancel here: ${opts.accountUrl}\n\n${planFooterText(opts.accountUrl)}`;
  return { subject, html, text };
}

/**
 * A plan was started at checkout with an address that was already on our
 * list (pending or unsubscribed). Nothing is sent to it until its owner confirms.
 */
export function paidConfirmationEmail(opts: { confirmUrl: string }) {
  const subject = `Confirm your email for ${siteConfig.name} alerts`;
  const html = layout(
    subject,
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">A ${esc(siteConfig.name)} ${esc(siteConfig.premium.name.toLowerCase())} plan was started with this email address. Before we send any alerts here, please confirm that it was you.</p>
     <p style="margin:0 0 20px">${button(opts.confirmUrl, "Confirm my email")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">If it wasn't you, ignore this email: we won't send alerts to this address. The plan is billed to whoever paid for it, not to you.</p>`,
    `You received this because this address was entered at checkout on ${esc(siteConfig.name)}.`,
  );
  const text = `A ${siteConfig.name} ${siteConfig.premium.name.toLowerCase()} plan was started with this email address. Before we send any alerts here, please confirm that it was you.\n\nConfirm: ${opts.confirmUrl}\n\nIf it wasn't you, ignore this email: we won't send alerts to this address. The plan is billed to whoever paid for it, not to you.\n\n${postal()}`;
  return { subject, html, text };
}

/** The one email promised to the early-access list: alerts are open. */
export function alertsOpenEmail(opts: { trialUrl: string; unsubscribeUrl: string }) {
  const p = siteConfig.premium;
  const subject = `${siteConfig.name} ${p.name.toLowerCase()} are open`;
  const lines = [
    `You joined the early-access list for ${siteConfig.name} ${p.name.toLowerCase()}. They're open now: new vacancies that match your saved searches, by email, daily or weekly.`,
    `You can start with a ${p.trialDays}-day free trial. A card is needed to start it. If you don't cancel during the trial, the plan costs ${p.priceSummary} ${EMAIL_TAX_NOTE} and renews until you cancel.`,
    `This is the one email we said we'd send. We won't email you about it again, and we'll delete your address from the early-access list 30 days from now unless you start a trial.`,
  ];
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 12px">${esc(p.name)} are open</h1>
     ${lines.map((l) => `<p style="font-size:16px;line-height:1.6;margin:0 0 12px">${esc(l)}</p>`).join("")}
     <p style="margin:8px 0 0">${button(opts.trialUrl, `Start my ${p.trialDays}-day free trial`)}</p>`,
    `You received this because you joined the early-access list on ${esc(siteConfig.name)}. <a href="${esc(opts.unsubscribeUrl)}" style="color:#566476">Unsubscribe</a>.`,
  );
  const text = `${lines.join("\n\n")}\n\nStart your free trial: ${opts.trialUrl}\n\nUnsubscribe: ${opts.unsubscribeUrl}\n\n${postal()}`;
  return { subject, html, text };
}
