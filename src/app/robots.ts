import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  // Preview deployments (git branches on Netlify or Vercel) must never be indexed.
  const isPreview =
    (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") ||
    (process.env.CONTEXT && process.env.CONTEXT !== "production");
  if (isPreview) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    // Organization icons under /api/org-logo/ appear on indexed pages, so they stay crawlable;
    // the longer "allow" rule wins over "/api/" for crawlers that follow RFC 9309.
    rules: [{ userAgent: "*", allow: ["/", "/api/org-logo/"], disallow: ["/admin", "/api/", "/alerts/confirm", "/alerts/unsubscribe", "/account"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
