/**
 * Share images (Open Graph) for the site and for each vacancy, drawn with next/og.
 * Plain type on the site's blue; no organization logos and no UN or EU emblems.
 */
import { ImageResponse } from "next/og";
import siteConfig from "@site-config";

export const OG_SIZE = { width: 1200, height: 630 };

/** `footer` defaults to the tagline without the EU (see src/lib/eu-claim.ts). */
type Lines = { eyebrow?: string; title: string; lines?: string[]; footer?: string };

function shorten(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function shareImage({ eyebrow, title, lines = [], footer }: Lines): ImageResponse {
  const long = title.length > 70;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #0A2566 0%, #0F3AA6 55%, #1D5BFF 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 40, borderRadius: 8, background: siteConfig.colors.highlight, display: "flex" }} />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -0.5 }}>{siteConfig.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {eyebrow ? <div style={{ fontSize: 28, color: "rgba(255,255,255,0.75)" }}>{shorten(eyebrow, 70)}</div> : null}
          <div style={{ fontSize: long ? 52 : 64, fontWeight: 700, lineHeight: 1.12, maxWidth: 1050 }}>{shorten(title, 120)}</div>
          {lines.map((l) => (
            <div key={l} style={{ fontSize: 32, color: "rgba(255,255,255,0.9)" }}>{shorten(l, 80)}</div>
          ))}
        </div>
        <div style={{ fontSize: 24, color: "rgba(255,255,255,0.7)" }}>{footer ?? siteConfig.home.withoutEu.tagline}</div>
      </div>
    ),
    OG_SIZE,
  );
}
