/**
 * Share images (Open Graph) for the site and for each vacancy, drawn with next/og in the site's
 * look: the sky field, the bird mark and the wordmark in Bricolage Grotesque, a white card with the
 * headline, and the closing date in a soft panel as on the vacancy cards (yellow when it closes
 * within days). No organization logos and no UN or EU emblems.
 *
 * Fonts: next/og reads TTF, OTF and WOFF, not WOFF2, so src/lib/og-assets holds static WOFF files:
 * Bricolage Grotesque 700 (from @fontsource/bricolage-grotesque) and Public Sans 400, latin and
 * latin-ext subsets, with their SIL Open Font License. The mark is src/app/icon.svg, read as is.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import siteConfig from "@site-config";

export const OG_SIZE = { width: 1200, height: 630 };

/** The site's colours (see globals.css): navy ink, postmark ink, closing-soon red, quiet grey. */
const INK = "#0b1f3a";
const SLATE = "#4d5f78";
const SKY_WASH = "#ddf1ff";
const SKY_RULE = "#bfe0fa";
const TINT = "#eaf4fd";
const TINT_INK = "#24405f";

type Fonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]>;
type Assets = { fonts: Fonts; mark: string | null };

let assets: Promise<Assets> | null = null;

/** Fonts and the mark, read once per server instance; without them the image still renders (default font, no mark). */
function loadAssets(): Promise<Assets> {
  assets ??= (async (): Promise<Assets> => {
    const dir = join(process.cwd(), "src/lib/og-assets");
    const [heading, headingExt, sans, sansExt, icon] = await Promise.all([
      readFile(join(dir, "bricolage-grotesque-latin-700-normal.woff")),
      readFile(join(dir, "bricolage-grotesque-latin-ext-700-normal.woff")),
      readFile(join(dir, "public-sans-latin-400.woff")),
      readFile(join(dir, "public-sans-latin-ext-400.woff")),
      readFile(join(process.cwd(), "src/app/icon.svg")),
    ]);
    return {
      fonts: [
        { name: "Bricolage Grotesque", data: heading, weight: 700 as const, style: "normal" as const },
        { name: "Bricolage Grotesque", data: headingExt, weight: 700 as const, style: "normal" as const },
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

/** The closing date as on the site's cards: a soft panel, yellow when it closes within days. */
function DeadlinePanel({ stamp }: { stamp: Stamp }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        width: 270, padding: "30px 20px", borderRadius: 28,
        background: stamp.urgent ? "#fff1c2" : TINT, color: INK,
      }}
    >
      <div style={{ fontSize: 30 }}>{stamp.top}</div>
      <div style={{ fontSize: 64, fontFamily: "Bricolage Grotesque", fontWeight: 700, lineHeight: 1.05 }}>{stamp.main}</div>
      {stamp.bottom ? <div style={{ fontSize: 28, fontWeight: stamp.urgent ? 700 : 400 }}>{stamp.bottom}</div> : null}
    </div>
  );
}

export async function shareImage({ eyebrow, title, lines = [], footer, stamp }: Lines): Promise<ImageResponse> {
  const { fonts, mark } = await loadAssets();
  const long = title.length > 70;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "44px 56px 40px", background: SKY_WASH, color: INK, fontFamily: "Public Sans" }}>
        {/* The mark and the wordmark, as in the site header. */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {mark ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- next/og draws images from <img>; the PNG has its own alt text.
            <img src={mark} width={60} height={60} style={{ borderRadius: 15 }} />
          ) : null}
          <div style={{ fontSize: 44, fontFamily: "Bricolage Grotesque", fontWeight: 700, letterSpacing: -0.5 }}>{siteConfig.name}</div>
        </div>
        {/* The white card, as the vacancy cards and the search box on the site. */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 36, marginTop: 28, padding: "36px 44px", background: "#ffffff", borderRadius: 32, border: `3px solid ${SKY_RULE}` }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            {eyebrow ? <div style={{ fontSize: 30, color: SLATE }}>{shorten(eyebrow, 60)}</div> : null}
            <div style={{ fontSize: long ? 52 : 64, fontFamily: "Bricolage Grotesque", fontWeight: 700, lineHeight: 1.08, letterSpacing: -0.5 }}>{shorten(title, 110)}</div>
            {lines.map((l) => (
              <div key={l} style={{ fontSize: 30, color: SLATE }}>{shorten(l, stamp ? 52 : 80)}</div>
            ))}
          </div>
          {stamp ? <DeadlinePanel stamp={stamp} /> : null}
        </div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 24, color: TINT_INK }}>{footer ?? siteConfig.home.withoutEu.tagline}</div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
