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
<tr><td style="padding:18px 28px;border-top:1px solid #dde3ea;font-size:12px;line-height:1.6;color:#566476">${footerHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${siteConfig.colors.brand};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(label)}</a>`;
}

export function confirmationEmail(opts: { confirmUrl: string; waitlist: boolean; alerts: boolean }) {
  const what = opts.alerts && opts.waitlist
    ? "the weekly job alert and the Premium launch list"
    : opts.waitlist
      ? "the Premium launch list"
      : "the weekly job alert";
  const subject = `Confirm your email for ${siteConfig.name}`;
  const html = layout(
    subject,
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">Please confirm that you want to receive ${esc(what)}.</p>
     <p style="margin:0 0 20px">${button(opts.confirmUrl, "Confirm my email")}</p>
     <p style="font-size:14px;line-height:1.6;color:#566476;margin:0">If you didn't sign up, ignore this email and you won't hear from us again.</p>`,
    `You received this because this address was entered on ${esc(siteConfig.name)}.`,
  );
  const text = `Please confirm that you want to receive ${what}.\n\nConfirm: ${opts.confirmUrl}\n\nIf you didn't sign up, ignore this email.`;
  return { subject, html, text };
}

export function digestEmail(opts: { jobs: JobListItem[]; total: number; unsubscribeUrl: string }) {
  const subject = `${opts.total} new international vacancies this week`;
  const rows = opts.jobs
    .map((j) => {
      const url = absoluteUrl(jobPath(j)) + "?utm_source=digest&utm_medium=email";
      return `<tr><td style="padding:14px 0;border-bottom:1px solid #dde3ea">
        <a href="${esc(url)}" style="font-family:Georgia,serif;font-size:17px;font-weight:600;color:#0e1b2c;text-decoration:none">${esc(j.title)}</a>
        <div style="font-size:14px;color:#0e1b2c;margin-top:4px">${esc(j.org_name ?? "Organization not specified")}</div>
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
     <p style="font-size:15px;color:#566476;margin:0 0 10px">Apply on each organization's official website.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>${more}`,
    `${esc(siteConfig.disclaimer)}<br><br><a href="${esc(opts.unsubscribeUrl)}" style="color:#566476">Unsubscribe</a> from these emails.`,
  );
  const text =
    `This week's new vacancies on ${siteConfig.name}\n\n` +
    opts.jobs.map((j) => `${j.title}\n${j.org_name ?? "Organization not specified"} | ${locationLabel(j)}${j.deadline ? ` | Closes ${formatDate(j.deadline)}` : ""}\n${absoluteUrl(jobPath(j))}`).join("\n\n") +
    `\n\nSee all: ${absoluteUrl("/jobs?posted=7")}\n\nUnsubscribe: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
}
