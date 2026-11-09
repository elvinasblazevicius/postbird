import { euListingsOpen, homeCopy } from "@/lib/eu-claim";
import { OG_SIZE, shareImage } from "@/lib/og";
import { siteConfig } from "@/lib/site";

// The alt text is fixed when the site is built, so it never names the EU (see src/lib/eu-claim.ts).
export const alt = `${siteConfig.name}: ${homeCopy(false).tagline}`;
export const size = OG_SIZE;
export const contentType = "image/png";
// Drawn when requested, so the headline names the EU only while EU institutions have open vacancies here.
export const dynamic = "force-dynamic";

export default async function Image() {
  return shareImage({
    title: homeCopy(await euListingsOpen()).headline,
    lines: ["Every listing links to the employer's own website."],
    footer: `Independent. Not affiliated with the United Nations, the EU or any employer listed.`,
  });
}
