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
 *
 * Paddle Billing (paid alerts; allowed in sandbox and production so the
 * switch needs no config change). Hosts taken from Paddle's docs and from
 * Paddle.js v2 itself (cdn.paddle.com/paddle/v2/paddle.js):
 *  - script: Paddle.js from cdn.paddle.com; on live accounts Paddle.js also
 *    loads Paddle Retain (public.profitwell.com), which reports to
 *    www2.profitwell.com.
 *  - style/img: checkout button CSS and images from cdn.paddle.com or
 *    sandbox-cdn.paddle.com.
 *  - frame: the overlay checkout iframe (buy.paddle.com /
 *    sandbox-buy.paddle.com) and its error page on the CDN. Card-network and
 *    wallet frames are nested inside Paddle's frame, under Paddle's own policy.
 *  - connect: price and transaction previews from api.paddle.com /
 *    sandbox-api.paddle.com.
 *  - form-action: "Manage billing" redirects to the customer portal; without
 *    JavaScript that is a form submission redirect, which form-action covers.
 */
const UET = "https://bat.bing.com https://bat.bing.net";
const PADDLE_CDN = "https://cdn.paddle.com https://sandbox-cdn.paddle.com";
const PADDLE_SCRIPT = "https://cdn.paddle.com https://public.profitwell.com";
const PADDLE_FRAME = `https://buy.paddle.com https://sandbox-buy.paddle.com ${PADDLE_CDN}`;
const PADDLE_CONNECT = "https://api.paddle.com https://sandbox-api.paddle.com https://www2.profitwell.com";
const PADDLE_PORTAL = "https://customer-portal.paddle.com https://sandbox-customer-portal.paddle.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${UET} ${PADDLE_SCRIPT}${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline' ${PADDLE_CDN}`,
  `img-src 'self' data: blob: ${UET} ${PADDLE_CDN}`,
  "font-src 'self' data:",
  `connect-src 'self' ${UET} ${PADDLE_CONNECT}${isDev ? " ws: wss:" : ""}`,
  `frame-src ${PADDLE_FRAME}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${PADDLE_PORTAL}`,
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Two years; covers subdomains of the site's own host. Browsers ignore it over plain http (local dev).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Paddle's checkout iframe asks for the Payment Request API (allow="payment") for Apple Pay / Google Pay.
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://buy.paddle.com" "https://sandbox-buy.paddle.com"), usb=()' },
];

/**
 * CDN caching for public pages (Netlify).
 *
 * The pages stay dynamic (rendered on request, so `next build` never needs the
 * database), but the same answer is good for everyone for a few minutes: none
 * of these pages reads cookies, request headers or anything about the visitor
 * (page views are counted in the browser through /api/track, not here).
 *  - Netlify-CDN-Cache-Control: Netlify's CDN keeps a page for 5 minutes and
 *    may serve it up to 10 more minutes while it fetches a fresh copy. Only
 *    Netlify reads this header. Next.js keeps a Cache-Control set here instead
 *    of its "private, no-store" (see send-payload.js), and Netlify's Next.js
 *    runtime keeps both when Netlify-CDN-Cache-Control is present.
 *  - Netlify-Vary: query: every query string is its own cache entry
 *    (/jobs?q=nurse and /jobs?q=pilot). Without it the runtime's default would
 *    key only on _rsc, and filtered pages would share one entry.
 *  - Cache-Control: browsers always check back (the CDN answers quickly).
 * GET and HEAD only: Netlify never caches POST (server actions). Each deploy
 * empties the CDN cache.
 * Never listed here: /account, /alerts/*, /admin, /api/* (except the sitemap
 * and robots.txt, which are pages in disguise), /account/login.
 * /pricing/trial is cached: it reads only its own query string (?search=,
 * ?remind=), which is part of the cache key, and shows nothing about the visitor.
 */
const CDN_CACHED_PAGES = [
  "/", "/jobs", "/jobs/:slug", "/organizations", "/organizations/:slug", "/locations", "/locations/:slug",
  "/categories", "/categories/:slug", "/remote-jobs", "/un-jobs", "/eu-jobs", "/development-bank-jobs", "/ngo-jobs",
  "/international-organization-jobs",
  "/pricing", "/pricing/trial", "/about", "/refunds", "/saved", "/sitemap.xml", "/robots.txt",
  // A vacancy's share image: rendered from the database like the page (force-dynamic), and fetched
  // by every chat app and social network a link is pasted into.
  "/jobs/:slug/opengraph-image",
];
const cdnCacheHeaders = [
  { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
  { key: "Netlify-CDN-Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=600" },
  { key: "Netlify-Vary", value: "query" },
];

const nextConfig: NextConfig = {
  // Pages read live data from the database on each request (see README → "How it works");
  // public pages are cached by the CDN for a few minutes (headers() below).
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
      ...CDN_CACHED_PAGES.map((source) => ({ source, headers: cdnCacheHeaders })),
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/account", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/account/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
