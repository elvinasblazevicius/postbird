import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySessionValue } from "@/lib/admin-auth";

/**
 * Whether a request path's percent-encoding is valid ("/jobs/%ZZ" is not).
 * Next.js answers a malformed one on a dynamic route with a 500; the proxy
 * answers 400 instead. Pure, so it is unit-tested.
 */
export function isDecodablePath(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps /admin behind the admin login, and answers 400 for a path with
 * malformed percent-encoding. The matcher below only sends it /admin and
 * paths that contain a "%", so ordinary pages (including the CDN-cached
 * public ones) and static files never run it.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isDecodablePath(pathname)) {
    return new NextResponse("Bad request: the address is not valid.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return NextResponse.next();
  if (pathname === "/admin/login") return NextResponse.next();
  if (!verifySessionValue(request.cookies.get(ADMIN_COOKIE)?.value)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Static files (/_next/static, /_next/image) are never matched; any other path with a "%" is.
  matcher: ["/admin", "/admin/:path*", "/((?!_next/static/|_next/image).*%.*)"],
};
