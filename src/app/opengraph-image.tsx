import { OG_SIZE, shareImage } from "@/lib/og";
import { siteConfig } from "@/lib/site";

export const alt = `${siteConfig.name}: ${siteConfig.tagline}`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return shareImage({
    title: siteConfig.home.headline,
    lines: ["Every listing links to the employer's own website."],
    footer: `Independent. Not affiliated with the United Nations, the EU or any employer listed.`,
  });
}
