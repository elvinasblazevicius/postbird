import { EPSO_BOOK } from "@/components/epso-book";
import { amazonBookUrl } from "@/lib/amazon-store";
import { countryFromHeaders } from "@/lib/visitor-country";

/**
 * Sends a visitor to our EPSO workbook on the Amazon store for their country (amazon.de from
 * Germany, amazon.fr from France, …; amazon.com when the country is unknown). The pages that link
 * here are cached for everyone, so the country is read here, at the click.
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(null, {
    status: 302,
    headers: {
      location: amazonBookUrl(EPSO_BOOK.asin, countryFromHeaders(req.headers)),
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
