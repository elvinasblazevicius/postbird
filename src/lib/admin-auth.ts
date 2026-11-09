/**
 * Single-password admin login. The password is ADMIN_PASSWORD; sessions are
 * signed cookies.
 *
 * The signing key is HMAC(ADMIN_SESSION_SECRET || CRON_SECRET, "admin-session|" + ADMIN_PASSWORD):
 *  - knowing CRON_SECRET alone is not enough to create a session;
 *  - changing ADMIN_PASSWORD ends every existing session.
 * Each session also carries the current "admin_session_version" from the
 * settings table; signing out increases it, which ends every session.
 * Sessions last 24 hours.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

// The database client is imported lazily so src/proxy.ts (signature check only) stays small.
const db = async () => (await import("@/lib/db")).sql;

export const ADMIN_COOKIE = "gch_admin";
const SESSION_HOURS = 24;
const VERSION_KEY = "admin_session_version";

function baseSecret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET || "";
  return s.length >= 16 ? s : null;
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 10 && baseSecret());
}

/** Session signing key, derived from the secret and the current password. */
function sessionKey(): Buffer {
  return createHmac("sha256", baseSecret()!).update(`admin-session|${process.env.ADMIN_PASSWORD ?? ""}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(given: string): boolean {
  if (!isAdminConfigured()) return false;
  const expected = process.env.ADMIN_PASSWORD ?? "";
  // Compare HMACs so the comparison takes the same time whatever the input length.
  const mac = (s: string) => createHmac("sha256", baseSecret()!).update(`pw:${s}`).digest("base64url");
  return safeEqual(mac(given), mac(expected));
}

/** Builds a signed session value for the given session version. */
export function createSessionValue(version: string): { value: string; maxAge: number } {
  if (!/^[0-9]{1,18}$/.test(version)) throw new Error("Invalid session version");
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  const payload = `v2.${version}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: SESSION_HOURS * 3600 };
}

/** Parses and checks the signature and expiry; returns the session version, or null. */
function parseSession(value: string | undefined | null): string | null {
  if (!value || !isAdminConfigured()) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v2" || !/^[0-9]{1,18}$/.test(parts[1])) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  if (!safeEqual(parts[3], sign(`${parts[0]}.${parts[1]}.${parts[2]}`))) return null;
  return parts[1];
}

/**
 * Signature and expiry only (no database), for the fast check in src/proxy.ts.
 * Pages, actions and routes must use verifyAdminSession, which also checks
 * that the session has not been revoked.
 */
export function verifySessionValue(value: string | undefined | null): boolean {
  return parseSession(value) !== null;
}

function isUndefinedTable(e: unknown): boolean {
  return (e as { code?: string })?.code === "42P01";
}

/** The current session version ("1" until the first sign-out). */
export async function getSessionVersion(): Promise<string> {
  try {
    const sql = await db();
    const [row] = await sql<{ value: string }[]>`select value from settings where key = ${VERSION_KEY}`;
    return row?.value ?? "1";
  } catch (e) {
    // Before db/migrations/003_security.sql is applied, sessions still need a valid signature.
    if (isUndefinedTable(e)) {
      console.warn("admin-auth: table settings is missing; run db/migrations/003_security.sql");
      return "1";
    }
    throw e;
  }
}

/** Ends every admin session (used by sign-out). */
export async function revokeAllSessions(): Promise<void> {
  const sql = await db();
  await sql`
    insert into settings (key, value) values (${VERSION_KEY}, '2')
    on conflict (key) do update set value = (settings.value::bigint + 1)::text, updated_at = now()`;
}

export async function createAdminSession(): Promise<{ value: string; maxAge: number }> {
  return createSessionValue(await getSessionVersion());
}

/** Full check: signature, expiry, and not revoked by a sign-out. */
export async function verifyAdminSession(value: string | undefined | null): Promise<boolean> {
  const version = parseSession(value);
  if (version === null) return false;
  try {
    return version === (await getSessionVersion());
  } catch {
    return false;
  }
}
