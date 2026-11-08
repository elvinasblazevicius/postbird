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
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/alerts/confirm", "/alerts/unsubscribe"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
