/**
 * Request hardening that needs no database: malformed percent-encoding in the
 * proxy, the webhook's body size limit, and the bounded concurrency used by
 * the paid alerts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config as proxyConfig, isDecodablePath, proxy } from "@/proxy";
import { readCapped } from "@/lib/read-capped";
import { mapLimit } from "@/lib/digest";

describe("malformed percent-encoding in the path", () => {
  it("is detected without touching valid paths", () => {
    for (const p of ["/jobs/%ZZ", "/organizations/%E0%A4%A", "/jobs/abc%2", "/%"]) expect(isDecodablePath(p)).toBe(false);
    for (const p of ["/", "/jobs", "/jobs/nurse-123", "/jobs/caf%C3%A9", "/jobs/x%20y", "/_next/static/chunks/a.js"]) expect(isDecodablePath(p)).toBe(true);
  });

  it("gets a 400 from the proxy; a valid path goes on, and /admin still needs a sign-in", () => {
    const bad = proxy(new NextRequest("http://localhost/jobs/%ZZ"));
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect(proxy(new NextRequest("http://localhost/admin/%ZZ")).status).toBe(400);
    expect(proxy(new NextRequest("http://localhost/jobs/caf%C3%A9")).headers.get("x-middleware-next")).toBe("1");
    const admin = proxy(new NextRequest("http://localhost/admin/subscribers"));
    expect(admin.status).toBe(307);
    expect(admin.headers.get("location")).toBe("http://localhost/admin/login");
  });

  it("runs only for /admin and for paths with a '%', never for static files", () => {
    // The same conversion Next.js applies to a matcher with its own regular expression.
    const re = new RegExp(`^${proxyConfig.matcher[2].replace(/\//g, "\\/")}$`);
    for (const p of ["/jobs/%ZZ", "/organizations/caf%C3%A9", "/%"]) expect(re.test(p)).toBe(true);
    for (const p of ["/jobs", "/jobs/nurse-123", "/", "/about", "/_next/static/%ZZ", "/_next/image"]) expect(re.test(p)).toBe(false);
  });
});

describe("webhook body size", () => {
  beforeAll(() => {
    process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test_secret_0123456789";
  });
  afterAll(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  const post = async (body: BodyInit, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/paddle/webhook/route");
    return POST(new Request("http://localhost/api/paddle/webhook", { method: "POST", body, headers, duplex: "half" } as RequestInit));
  };

  it("refuses a declared size over 512 KB before reading the body", async () => {
    let pulled = false;
    // highWaterMark 0: the stream produces data only when someone reads it.
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled = true; c.enqueue(new Uint8Array(10)); c.close(); } }, { highWaterMark: 0 });
    const res = await post(stream, { "content-length": String(512 * 1024 + 1), "paddle-signature": "ts=1;h1=00" });
    expect(res.status).toBe(413);
    expect(pulled).toBe(false);
  });

  it("stops reading a body without a size once it passes 512 KB", async () => {
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        chunks++;
        c.enqueue(new Uint8Array(64 * 1024).fill(97));
        if (chunks > 100) c.close();
      },
    });
    const res = await post(stream, { "paddle-signature": "ts=1;h1=00" });
    expect(res.status).toBe(413);
    expect(chunks).toBeLessThan(20);
  });

  it("reads a normal body in full (a bad signature is then refused as before)", async () => {
    const body = JSON.stringify({ event_id: "evt_1", event_type: "customer.created", data: { name: "Zoë" } });
    expect(await readCapped(new Request("http://localhost/", { method: "POST", body }), 512 * 1024)).toBe(body);
    expect((await post(body, { "paddle-signature": "ts=1;h1=00" })).status).toBe(401);
  });
});

describe("mapLimit", () => {
  it("runs every item, in order, never more than the limit at once", async () => {
    let running = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(peak).toBe(4);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
