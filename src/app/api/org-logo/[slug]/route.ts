import { sql } from "@/lib/db";
import { logoProtectedSql } from "@/lib/feeds/logos";

export const dynamic = "force-dynamic";

/** An organization's stored icon. Cached for a week by browsers and the CDN. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response("Not found", { status: 404 });
  // Never a protected emblem: UN system, EU institutions, Red Cross and Red Crescent (see src/lib/feeds/logos.ts).
  const [row] = await sql<{ logo: Buffer | null; logo_type: string | null }[]>`
    select logo, logo_type from organizations
    where slug = ${slug} and logo is not null and not ${logoProtectedSql("organizations")}`;
  if (!row?.logo || row.logo_type !== "image/png") return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=3600" } });
  return new Response(new Uint8Array(row.logo), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=604800, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
