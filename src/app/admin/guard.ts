import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifySessionValue } from "@/lib/admin-auth";

/** Every admin page and action calls this, in addition to the proxy check. */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  if (!verifySessionValue(jar.get(ADMIN_COOKIE)?.value)) redirect("/admin/login");
}
