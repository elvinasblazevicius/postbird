import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
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

// Microsoft requires an ad-consent signal for visitors in the EEA, the UK and Switzerland.
const CONSENT_COUNTRIES = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "),
);

function visitorCountry(h: Headers): string | null {
  const vercel = h.get("x-vercel-ip-country");
  if (vercel) return vercel;
  const nfGeo = h.get("x-nf-geo"); // Netlify: base64-encoded JSON
  if (nfGeo) {
    try {
      const geo = JSON.parse(Buffer.from(nfGeo, "base64").toString("utf8")) as { country?: { code?: string } };
      if (geo.country?.code) return geo.country.code;
    } catch {
      /* fall through */
    }
  }
  return h.get("x-country") || h.get("cf-ipcountry");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const uetTagId = process.env.NEXT_PUBLIC_MS_UET_TAG_ID?.trim() || null;
  // The host tells us the visitor's country; when it's unknown, ask for consent to be safe.
  const country = uetTagId ? visitorCountry(await headers()) : null;
  const consentRequired = !country || CONSENT_COUNTRIES.has(country.toUpperCase());
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
        <AdsManager tagId={uetTagId} consentRequired={consentRequired} />
      </body>
    </html>
  );
}
