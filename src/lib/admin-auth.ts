/**
 * Single-password admin login. The password is ADMIN_PASSWORD; sessions are
 * signed cookies (HMAC with ADMIN_SESSION_SECRET, or CRON_SECRET as fallback).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "gch_admin";
const SESSION_DAYS = 14;

function secret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET || "";
  return s.length >= 16 ? s : null;
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 10 && secret());
}

function sign(payload: string): string {
  return createHmac("sha256", secret()!).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(given: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!isAdminConfigured()) return false;
  // Compare HMACs so the comparison takes the same time whatever the input length.
  return safeEqual(sign(`pw:${given}`), sign(`pw:${expected}`));
}

export function createSessionValue(): { value: string; maxAge: number } {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `admin.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: SESSION_DAYS * 86_400 };
}

export function verifySessionValue(value: string | undefined | null): boolean {
  if (!value || !secret()) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(parts[2], sign(`${parts[0]}.${parts[1]}`));
}
