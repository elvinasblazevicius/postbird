import siteConfig from "@site-config";
import type { JobListItem } from "@/lib/jobs";
import { absoluteUrl, formatDate, jobPath, locationLabel } from "@/lib/site";

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
    ? "the weekly job alert and early access to paid email alerts"
    : opts.waitlist
      ? "early access to paid email alerts (one email when they open; nothing is charged)"
      : "the weekly job alert";
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

export function digestEmail(opts: { jobs: JobListItem[]; total: number; unsubscribeUrl: string }) {
  const subject = `${opts.total} new international vacancies this week`;
  const rows = opts.jobs
    .map((j) => {
      const url = absoluteUrl(jobPath(j)) + "?utm_source=digest&utm_medium=email";
      return `<tr><td style="padding:14px 0;border-bottom:1px solid #dde3ea">
        <a href="${esc(url)}" style="font-family:Georgia,serif;font-size:17px;font-weight:600;color:#0e1b2c;text-decoration:none">${esc(j.title)}</a>
        <div style="font-size:14px;color:#0e1b2c;margin-top:4px">${esc(j.org_name ?? "Organization not stated")}</div>
        <div style="font-size:13px;color:#566476;margin-top:2px">${esc(locationLabel(j))}${j.deadline ? ` &nbsp;|&nbsp; Closes ${esc(formatDate(j.deadline))}` : ""}</div>
      </td></tr>`;
    })
    .join("");
  const more = opts.total > opts.jobs.length
    ? `<p style="margin:20px 0 0">${button(absoluteUrl("/jobs?posted=7"), `See all ${opts.total} new vacancies`)}</p>`
    : "";
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 6px">This week's new vacancies</h1>
     <p style="font-size:15px;color:#566476;margin:0 0 10px">Apply on each employer's own website.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>${more}`,
    `${esc(siteConfig.disclaimer)}<br><br><a href="${esc(opts.unsubscribeUrl)}" style="color:#566476">Unsubscribe</a> from these emails.`,
  );
  const text =
    `This week's new vacancies on ${siteConfig.name}\n\n` +
    opts.jobs.map((j) => `${j.title}\n${j.org_name ?? "Organization not stated"} | ${locationLabel(j)}${j.deadline ? ` | Closes ${formatDate(j.deadline)}` : ""}\n${absoluteUrl(jobPath(j))}`).join("\n\n") +
    `\n\nSee all: ${absoluteUrl("/jobs?posted=7")}\n\nUnsubscribe: ${opts.unsubscribeUrl}\n\n${postal()}`;
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

/** Sent once when a subscriber's trial (or subscription) starts. */
export function welcomeEmail(opts: { accountUrl: string; unsubscribeUrl: string; trialEndsAt: string | null; plan: string }) {
  const subject = `Your ${siteConfig.name} ${siteConfig.premium.name.toLowerCase()} are on`;
  const trial = opts.trialEndsAt
    ? `Your free trial runs until ${formatDate(opts.trialEndsAt)}. After that you're billed for ${opts.plan} unless you cancel before then. You can cancel any time from your account page.`
    : `Your plan: ${opts.plan}. You can cancel any time from your account page.`;
  const html = layout(
    subject,
    `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.3;margin:0 0 12px">Welcome to ${esc(siteConfig.premium.name.toLowerCase())}</h1>
     <p style="font-size:16px;line-height:1.6;margin:0 0 12px">We'll email you new vacancies that match your saved searches. Your first alert arrives with the next round of new listings.</p>
     <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#566476">${esc(trial)}</p>
     <p style="margin:0 0 20px">${button(opts.accountUrl, "Open my account")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">On your account page you can add up to 5 saved searches, choose daily or weekly emails, and manage billing. Keep this email: the button is your private link.</p>`,
    accountFooter(opts.accountUrl, opts.unsubscribeUrl),
  );
  const text = `Welcome to ${siteConfig.premium.name.toLowerCase()} on ${siteConfig.name}.\n\nWe'll email you new vacancies that match your saved searches.\n\n${trial}\n\nYour account (keep this link private): ${opts.accountUrl}\n\n${accountFooterText(opts.accountUrl, opts.unsubscribeUrl)}`;
  return { subject, html, text };
}

/** "Email me my account link" (sent only to the address itself). */
export function accountLinkEmail(opts: { accountUrl: string; unsubscribeUrl: string }) {
  const subject = `Your ${siteConfig.name} account link`;
  const html = layout(
    subject,
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Here is the link to your ${esc(siteConfig.name)} account, where you can change your saved searches, choose daily or weekly emails and manage billing.</p>
     <p style="margin:0 0 20px">${button(opts.accountUrl, "Open my account")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">If you didn't ask for this, you can ignore this email. The link only works for this address.</p>`,
    accountFooter(opts.accountUrl, opts.unsubscribeUrl),
  );
  const text = `Your ${siteConfig.name} account: ${opts.accountUrl}\n\nIf you didn't ask for this, ignore this email.\n\n${accountFooterText(opts.accountUrl, opts.unsubscribeUrl)}`;
  return { subject, html, text };
}

export type AlertGroup = { label: string; url: string; jobs: JobListItem[]; total: number };

/** One email per subscriber with the new matches for each saved search. */
export function alertEmail(opts: { groups: AlertGroup[]; frequency: "daily" | "weekly"; accountUrl: string; unsubscribeUrl: string }) {
  const total = opts.groups.reduce((n, g) => n + g.total, 0);
  const subject = `${total} new ${total === 1 ? "vacancy matches" : "vacancies match"} your ${opts.groups.length === 1 ? "search" : "searches"}`;
  const jobRow = (j: JobListItem) => {
    const url = absoluteUrl(jobPath(j)) + "?utm_source=alert&utm_medium=email";
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #dde3ea">
      <a href="${esc(url)}" style="font-family:Georgia,serif;font-size:17px;font-weight:600;color:#0e1b2c;text-decoration:none">${esc(j.title)}</a>
      <div style="font-size:14px;color:#0e1b2c;margin-top:4px">${esc(j.org_name ?? "Organization not stated")}</div>
      <div style="font-size:13px;color:#566476;margin-top:2px">${esc(locationLabel(j))}${j.deadline ? ` &nbsp;|&nbsp; Closes ${esc(formatDate(j.deadline))}` : ""}</div>
    </td></tr>`;
  };
  const sections = opts.groups
    .map((g) => {
      const more = g.total > g.jobs.length
        ? `<p style="margin:12px 0 0"><a href="${esc(g.url)}" style="color:${siteConfig.colors.accent};font-weight:600">See all ${g.total} matches</a></p>`
        : "";
      return `<h2 style="font-size:16px;margin:24px 0 4px;color:#0e1b2c">${esc(g.label)} <span style="font-weight:400;color:#566476">(${g.total} new)</span></h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${g.jobs.map(jobRow).join("")}</table>${more}`;
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
    opts.groups
      .map((g) => `${g.label} (${g.total} new)\n\n` +
        g.jobs.map((j) => `${j.title}\n${j.org_name ?? "Organization not stated"} | ${locationLabel(j)}${j.deadline ? ` | Closes ${formatDate(j.deadline)}` : ""}\n${absoluteUrl(jobPath(j))}`).join("\n\n") +
        (g.total > g.jobs.length ? `\n\nSee all ${g.total}: ${g.url}` : ""))
      .join("\n\n---\n\n") +
    `\n\n${accountFooterText(opts.accountUrl, opts.unsubscribeUrl)}`;
  return { subject, html, text };
}
