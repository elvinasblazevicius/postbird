import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifyAdminSession } from "@/lib/admin-auth";

/**
 * Every admin page and action calls this. src/proxy.ts only checks the
 * cookie's signature; this also checks the session wasn't ended by a sign-out.
 */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  if (!(await verifyAdminSession(jar.get(ADMIN_COOKIE)?.value))) redirect("/admin/login");
}
