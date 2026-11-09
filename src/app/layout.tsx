import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AdsManager } from "@/components/ads";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PageviewTracker } from "@/components/tracking";
import { defaultSiteCopy } from "@/lib/eu-claim";
import { siteConfig, siteUrl } from "@/lib/site";

/*
 * Fonts: the latin files, plus latin-ext for names such as "Łódź", "Côte d'Ivoire" or "Türkiye"
 * (Polish, Czech, Turkish and other letters with Latin bases). The latin-ext files are a family of
 * their own with a unicode-range, listed FIRST in the font stacks in globals.css: for ordinary
 * letters the browser skips them (outside their range) and uses the latin files; for a letter
 * such as "ł" it uses them instead of the metric-matched local fallback. They are only
 * downloaded by pages that use one of their characters. Ranges from @fontsource-variable/<font>/unicode.json (next/font needs
 * them written out as literals).
 */
const publicSans = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2", style: "normal", weight: "100 900" },
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-italic.woff2", style: "italic", weight: "100 900" },
  ],
  declarations: [
    { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
  variable: "--font-public-sans",
  display: "swap",
});

const publicSansExt = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-ext-wght-normal.woff2", style: "normal", weight: "100 900" },
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-ext-wght-italic.woff2", style: "italic", weight: "100 900" },
  ],
  declarations: [
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-public-sans-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const newsreader = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2", style: "normal", weight: "200 800" }],
  declarations: [
    { prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  ],
  variable: "--font-newsreader",
  display: "swap",
});

const newsreaderExt = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-ext-opsz-normal.woff2", style: "normal", weight: "200 800" }],
  declarations: [
    { prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  ],
  variable: "--font-newsreader-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

// Defaults for pages that don't set their own: never naming the EU (see defaultSiteCopy in
// src/lib/eu-claim.ts). The homepage names it while EU institutions have open vacancies here.
const defaults = defaultSiteCopy();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${siteConfig.name} — ${defaults.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: defaults.description,
  applicationName: siteConfig.name,
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${defaults.tagline}`,
    description: defaults.description,
  },
  // Title and description come from openGraph (Next.js fills them in), also on pages that set their own.
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: siteConfig.colors.brand,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const uetTagId = process.env.NEXT_PUBLIC_MS_UET_TAG_ID?.trim() || null;
  const brandVars = {
    "--brand": siteConfig.colors.brand,
    "--accent": siteConfig.colors.accent,
    "--ink": siteConfig.colors.ink,
    "--sky": siteConfig.colors.sky,
    "--candy": siteConfig.colors.candy,
    "--highlight": siteConfig.colors.highlight,
  } as React.CSSProperties;

  return (
    <html lang="en" className={`${publicSans.variable} ${publicSansExt.variable} ${newsreader.variable} ${newsreaderExt.variable} antialiased`} style={brandVars}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-paper focus:px-3 focus:py-2">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <PageviewTracker />
        <AdsManager tagId={uetTagId} />
      </body>
    </html>
  );
}
