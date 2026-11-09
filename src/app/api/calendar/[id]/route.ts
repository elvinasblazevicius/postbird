import { getJob } from "@/lib/jobs";
import { absoluteUrl, jobPath, siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines to 75 octets (bytes) as the iCalendar format requires, without splitting a character. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const max = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > max) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** "Add deadline to calendar": an all-day event on the closing date. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Up to 12 digits, like job URLs (parseJobParam): longer numbers would overflow the database's bigint.
  const raw = (await params).id.replace(/\.ics$/, "");
  if (!/^\d{1,12}$/.test(raw) || Number(raw) <= 0) return new Response("Not found", { status: 404 });
  const id = Number(raw);
  const job = await getJob(id);
  if (!job || job.status === "removed" || !job.deadline) return new Response("This vacancy has no deadline to add.", { status: 404 });

  const start = job.deadline.replace(/-/g, "");
  const endDate = new Date(`${job.deadline}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const url = absoluteUrl(jobPath(job));
  const title = `Deadline: ${job.title}${job.org_name ? ` (${job.org_name})` : ""}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${icsText(siteConfig.name)}//Deadlines//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:job-${job.id}-deadline@${new URL(url).hostname}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(`Last day to apply. Check the closing time on the employer's own posting.\n${url}`)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "TRIGGER:-P2D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="deadline-${job.id}.ics"`,
      "x-robots-tag": "noindex",
    },
  });
}
