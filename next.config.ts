import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy.
 *
 * Every resource the site loads is its own (pages, /_next assets, fonts
 * bundled by next/font, /flags, /api/org-logo icons, /api/track beacons),
 * except Microsoft Advertising's UET tag: https://bat.bing.com/bat.js plus the
 * tag-specific script and its conversion beacons (image, fetch or
 * sendBeacon), which use bat.bing.com and, in newer tag versions,
 * bat.bing.net.
 *
 * script-src needs 'unsafe-inline': Next.js emits inline bootstrap scripts
 * (the RSC payload) and the pages emit JSON-LD. Nonces would avoid that, but
 * Next.js can only add a nonce to dynamically rendered pages (generated on
 * every request by the proxy), which would rule out static and cached pages.
 * Because the site renders no user-supplied HTML except sanitized job
 * descriptions (no scripts, no event handlers, no inline styles), the
 * remaining protection from the other directives (no plugins, no foreign
 * scripts, no framing, no foreign form targets, no <base> hijacking) is
 * the trade-off chosen here.
 * style-src needs 'unsafe-inline' for React style attributes and Next.js's
 * inline font/style tags.
 * If "Microsoft Clarity" is switched on in the UET tag settings, add
 * https://*.clarity.ms to script-src, img-src and connect-src.
 */
const UET = "https://bat.bing.com https://bat.bing.net";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${UET}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${UET}`,
  "font-src 'self' data:",
  `connect-src 'self' ${UET}${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Two years; covers subdomains of the site's own host. Browsers ignore it over plain http (local dev).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Pages read live data from the database on each request (see README → "How it works").
  cacheComponents: false,
  poweredByHeader: false,
  // sanitize-html (used only by the feed import) is bundled, not left as an
  // external package. With Turbopack, an external package is loaded through a
  // hashed alias such as `.next/node_modules/sanitize-html-<hash>` (a symlink
  // into node_modules), which hosting adapters such as Netlify's do not always
  // carry into the server function; every route that imported the feed sync
  // (/api/cron/*, the admin pages) then failed with a 500 before running.
  // postcss, which sanitize-html requires, is on Next.js's default
  // external list, so it is listed here too to make it bundled as well.
  transpilePackages: ["sanitize-html", "postcss"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
