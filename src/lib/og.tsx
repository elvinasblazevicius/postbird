/**
 * Share images (Open Graph) for the site and for each vacancy, drawn with next/og: the site's navy
 * band with the bird mark and the serif wordmark, the headline in Newsreader on white like a
 * letter, the closing date as the site's postmark, and an airmail edge along the bottom. No
 * organization logos and no UN or EU emblems.
 *
 * Fonts: next/og reads TTF, OTF and WOFF, not WOFF2, and the @fontsource-variable packages ship
 * only WOFF2 variable fonts. So src/lib/og-assets holds static WOFF instances made from those same
 * files (Newsreader at weight 600 and optical size 60; Public Sans at 400; latin and latin-ext
 * subsets), with their SIL Open Font License. The mark is src/app/icon.svg, read as is.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import siteConfig from "@site-config";

export const OG_SIZE = { width: 1200, height: 630 };

/** The site's colours (see globals.css): navy ink, postmark ink, closing-soon red, quiet grey. */
const INK = "#0e1f3d";
const POSTMARK = "#2b4170";
const SIGNAL = "#b42318";
const SLATE = "#536079";

type Fonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]>;
type Assets = { fonts: Fonts; mark: string | null };

let assets: Promise<Assets> | null = null;

/** Fonts and the mark, read once per server instance; without them the image still renders (default font, no mark). */
function loadAssets(): Promise<Assets> {
  assets ??= (async (): Promise<Assets> => {
    const dir = join(process.cwd(), "src/lib/og-assets");
    const [serif, serifExt, sans, sansExt, icon] = await Promise.all([
      readFile(join(dir, "newsreader-latin-600.woff")),
      readFile(join(dir, "newsreader-latin-ext-600.woff")),
      readFile(join(dir, "public-sans-latin-400.woff")),
      readFile(join(dir, "public-sans-latin-ext-400.woff")),
      readFile(join(process.cwd(), "src/app/icon.svg")),
    ]);
    return {
      fonts: [
        { name: "Newsreader", data: serif, weight: 600 as const, style: "normal" as const },
        { name: "Newsreader", data: serifExt, weight: 600 as const, style: "normal" as const },
        { name: "Public Sans", data: sans, weight: 400 as const, style: "normal" as const },
        { name: "Public Sans", data: sansExt, weight: 400 as const, style: "normal" as const },
      ],
      mark: `data:image/svg+xml;base64,${icon.toString("base64")}`,
    };
  })().catch((e): Assets => {
    console.error("share image assets failed to load", (e as Error).message);
    assets = null;
    return { fonts: [], mark: null };
  });
  return assets as Promise<Assets>;
}

/** The closing-date postmark's words (closingStamp in src/components/postmark.tsx). */
export type Stamp = { top: string; main: string; bottom: string | null; urgent: boolean };

/** `footer` defaults to the tagline without the EU (see src/lib/eu-claim.ts). */
type Lines = { eyebrow?: string; title: string; lines?: string[]; footer?: string; stamp?: Stamp | null };

function shorten(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The postmark: a double ring, set at an angle, with wavy cancellation lines running out of it. */
function Postmark({ stamp }: { stamp: Stamp }) {
  const color = stamp.urgent ? SIGNAL : POSTMARK;
  return (
    <div style={{ display: "flex", alignItems: "center", transform: "rotate(-7deg)", color }}>
      <svg width="96" height="72" viewBox="0 0 40 30" style={{ marginRight: -14, opacity: 0.55 }}>
        {[7, 15, 23].map((y) => (
          <path key={y} d={`M0 ${y}c3.3-3 6.7-3 10 0s6.7 3 10 0 6.7-3 10 0 6.7 3 10 0`} fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        ))}
      </svg>
      <div style={{ width: 236, height: 236, borderRadius: 9999, border: `5px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <div
          style={{
            width: 212, height: 212, borderRadius: 9999, border: `2px solid ${color}`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 30, fontFamily: "Public Sans" }}>{stamp.top}</div>
          <div style={{ fontSize: 50, fontFamily: "Newsreader", fontWeight: 600, lineHeight: 1.05 }}>{stamp.main}</div>
          {stamp.bottom ? <div style={{ fontSize: 28, fontFamily: "Public Sans" }}>{stamp.bottom}</div> : null}
        </div>
      </div>
    </div>
  );
}

export async function shareImage({ eyebrow, title, lines = [], footer, stamp }: Lines): Promise<ImageResponse> {
  const { fonts, mark } = await loadAssets();
  const long = title.length > 70;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff", color: INK, fontFamily: "Public Sans" }}>
        {/* The navy band: the mark and the wordmark, as in the site header. */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, height: 128, padding: "0 72px", background: INK, color: "#ffffff" }}>
          {mark ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- next/og draws images from <img>; the PNG has its own alt text.
            <img src={mark} width={64} height={64} style={{ borderRadius: 16 }} />
          ) : null}
          <div style={{ fontSize: 46, fontFamily: "Newsreader", fontWeight: 600, letterSpacing: -0.5 }}>{siteConfig.name}</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 40, padding: "0 72px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
            {eyebrow ? <div style={{ fontSize: 30, color: SLATE }}>{shorten(eyebrow, 60)}</div> : null}
            <div style={{ fontSize: long ? 54 : 66, fontFamily: "Newsreader", fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.5 }}>{shorten(title, 110)}</div>
            {lines.map((l) => (
              <div key={l} style={{ fontSize: 30, color: SLATE }}>{shorten(l, stamp ? 56 : 80)}</div>
            ))}
          </div>
          {stamp ? <Postmark stamp={stamp} /> : null}
        </div>
        <div style={{ display: "flex", padding: "0 72px 28px", fontSize: 24, color: SLATE }}>{footer ?? siteConfig.home.withoutEu.tagline}</div>
        {/* The airmail edge, as along the bottom of the home page's hero. */}
        <div
          style={{
            height: 14,
            display: "flex",
            backgroundImage: `repeating-linear-gradient(-45deg, ${SIGNAL} 0px, ${SIGNAL} 22px, #ffffff 22px, #ffffff 34px, ${INK} 34px, ${INK} 56px, #ffffff 56px, #ffffff 68px)`,
          }}
        />
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
