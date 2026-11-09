import { euListingsOpen, homeCopy } from "@/lib/eu-claim";
import { closingStamp } from "@/components/postmark";
import { OG_SIZE, shareImage } from "@/lib/og";
import { locationLabel, NOT_SPECIFIED, siteConfig } from "@/lib/site";
import { isJobOpen, loadJob } from "./job-data";

export const alt = `Vacancy on ${siteConfig.name}`;
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** Share image for a vacancy: title, organization, location, and the closing date as the site's postmark. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const job = await loadJob((await params).slug).catch(() => null);
  // A closed or unknown vacancy: the site's headline, naming the EU only while it has EU vacancies.
  if (!job || !isJobOpen(job)) return shareImage({ title: homeCopy(await euListingsOpen()).headline });
  const where = locationLabel(job);
  return shareImage({
    eyebrow: job.org_name ?? undefined,
    title: job.title,
    lines: [where !== NOT_SPECIFIED ? where : null, job.deadline ? null : "No closing date in our source"].filter((x): x is string => Boolean(x)),
    stamp: closingStamp(job.deadline, "lg"),
    footer: "Independent listing · apply on the employer's site",
  });
}
