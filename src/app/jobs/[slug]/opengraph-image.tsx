import { OG_SIZE, shareImage } from "@/lib/og";
import { formatDate, locationLabel, NOT_SPECIFIED, siteConfig } from "@/lib/site";
import { isJobOpen, loadJob } from "./job-data";

export const alt = `Vacancy on ${siteConfig.name}`;
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** Share image for a vacancy: title, organization, location and closing date. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const job = await loadJob((await params).slug).catch(() => null);
  if (!job || !isJobOpen(job)) return shareImage({ title: siteConfig.home.headline });
  const where = locationLabel(job);
  return shareImage({
    eyebrow: job.org_name ?? undefined,
    title: job.title,
    lines: [where !== NOT_SPECIFIED ? where : null, job.deadline ? `Closes ${formatDate(job.deadline)}` : null].filter((x): x is string => Boolean(x)),
    footer: "Independent listing · apply on the employer's site",
  });
}
