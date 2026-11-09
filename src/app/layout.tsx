import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AdsManager } from "@/components/ads";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PageviewTracker } from "@/components/tracking";
import { siteConfig, siteUrl } from "@/lib/site";

const publicSans = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2", style: "normal", weight: "100 900" },
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-italic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-public-sans",
  display: "swap",
});

const newsreader = localFont({
  src: [{ path: "../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2", style: "normal", weight: "200 800" }],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
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
    <html lang="en" className={`${publicSans.variable} ${newsreader.variable} antialiased`} style={brandVars}>
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
