/**
 * Database integration tests. They run only when TEST_DATABASE_URL points at
 * a THROWAWAY PostgreSQL database (tables are emptied); otherwise they are
 * skipped, so `npm test` still passes without a database.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/pb_test npm test
 */
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const ADMIN_PASSWORD = "correct horse battery";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

function fixtureFeed(): string {
  return readFileSync(path.join(__dirname, "..", "fixtures", "feed-integration.xml"), "utf8")
    .replaceAll("{{PUB_DATE}}", daysFromNow(-5).toUTCString())
    .replaceAll("{{FUTURE_DATE}}", iso(daysFromNow(30)))
    .replaceAll("{{PAST_DATE}}", iso(daysFromNow(-2)));
}

describe.skipIf(!TEST_DB)("database integration", () => {
  let server: Server;
  let base = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  let sync: typeof import("@/lib/feeds/sync");
  let auth: typeof import("@/lib/admin-auth");
  let limiter: typeof import("@/lib/rate-limit");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.INOREADER_FEED_URLS;
    delete process.env.FEED_URLS;
    delete process.env.SYNC_TIME_BUDGET_MS;
    delete process.env.VERCEL;

    sql = (await import("@/lib/db")).getSql();
    // Apply every migration (they are idempotent).
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    }
    await sql.unsafe(`truncate jobs, job_sources, feeds, organizations, sync_runs, sync_items, events,
      rate_limits, admin_login_failures, settings restart identity cascade`);
    await sql`update locks set locked_until = null, holder = null`;

    sync = await import("@/lib/feeds/sync");
    auth = await import("@/lib/admin-auth");
    limiter = await import("@/lib/rate-limit");

    // Built once: dates made per request could differ by a second between two
    // syncs, and the second sync would then count every listing as updated.
    const feed = fixtureFeed();
    server = createServer((req, res) => {
      if (req.url === "/feed.xml") {
        res.writeHead(200, { "content-type": "application/rss+xml" });
        res.end(feed);
      } else if (req.url === "/huge") {
        // 20 MB, streamed without a Content-Length header.
        res.writeHead(200, { "content-type": "application/xml" });
        const chunk = Buffer.alloc(1_000_000, 0x61);
        let sent = 0;
        const pump = () => {
          while (sent < 20) {
            sent++;
            if (!res.write(chunk)) return void res.once("drain", pump);
          }
          res.end();
        };
        res.on("error", () => {});
        pump();
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await sql`insert into feeds (name, url, content_policy) values ('Fixture feed', ${`${base}/feed.xml`}, 'excerpt')`;
    // Icons are only fetched for organizations not checked recently: keep the tests offline.
    await sql`insert into organizations (slug, name, logo_checked_at) values ('example-agency', 'Example Agency', now())`;
  });

  afterAll(async () => {
    server?.closeAllConnections?.();
    await new Promise((r) => (server ? server.close(r) : r(null)));
    await sql?.end();
  });

  describe("sync", () => {
    beforeEach(async () => {
      await sql`update locks set locked_until = null, holder = null`;
    });

    it("imports a feed and creates no duplicates when the same feed is read again", async () => {
      const first = await sync.runSync("cli");
      expect(first.status).toBe("success");
      expect(first.created).toBe(3);
      expect(first.feeds).toEqual([expect.objectContaining({ name: "Fixture feed", status: "ok", items: 3, error: null })]);
      const [{ n: afterFirst }] = await sql`select count(*)::int as n from jobs`;

      const second = await sync.runSync("cli");
      expect(second.status).toBe("success");
      expect(second.created).toBe(0);
      expect(second.updated).toBe(0);
      expect(second.unchanged).toBe(3);
      const [{ n: afterSecond }] = await sql`select count(*)::int as n from jobs`;
      expect(afterSecond).toBe(afterFirst);
      const [{ n: sources }] = await sql`select count(*)::int as n from job_sources`;
      expect(sources).toBe(3);
    });

    it("closes listings whose deadline has passed", async () => {
      const [past] = await sql`select status from jobs where apply_url like '%/it-1002'`;
      expect(past.status).toBe("expired"); // imported as closed
      const [future] = await sql`select status from jobs where apply_url like '%/it-1001'`;
      expect(future.status).toBe("active");

      // An open listing whose deadline passes between syncs.
      const [{ id }] = await sql`
        insert into jobs (slug, title, apply_url, apply_host, url_hash, deadline, status)
        values ('old-job', 'Old job', 'https://example.org/old', 'example.org', 'it-old-hash', ${iso(daysFromNow(-1))}, 'active')
        returning id`;
      const r = await sync.runSync("cli");
      expect(r.expired).toBeGreaterThanOrEqual(1);
      const [row] = await sql`select status from jobs where id = ${id}`;
      expect(row.status).toBe("expired");
    });

    it("skips a sync while another one holds the lock", async () => {
      expect(await sync.acquireLock("sync", "someone-else", 1)).toBe(true);
      const r = await sync.runSync("manual");
      expect(r.status).toBe("skipped");
      const [run] = await sql`select status from sync_runs where id = ${r.runId}`;
      expect(run.status).toBe("skipped");
      // The other holder still has it; releasing as a different holder does nothing.
      await sync.releaseLock("sync", "not-the-holder");
      expect(await sync.acquireLock("sync", "third", 1)).toBe(false);
      await sync.releaseLock("sync", "someone-else");
      expect(await sync.acquireLock("sync", "third", 1)).toBe(true);
      await sync.releaseLock("sync", "third");
    });

    it("uses a short lock lease for website-triggered runs and releases it afterwards", async () => {
      await sync.acquireLock("sync", "lease-check", 1);
      const [{ secs }] = await sql`select extract(epoch from locked_until - now())::int as secs from locks where name = 'sync'`;
      expect(secs).toBeGreaterThan(50);
      expect(secs).toBeLessThanOrEqual(60);
      await sync.releaseLock("sync", "lease-check");

      const r = await sync.runSync("manual");
      expect(r.status).not.toBe("skipped");
      const [lock] = await sql`select locked_until from locks where name = 'sync'`;
      expect(lock.locked_until).toBeNull();
    });

    it("marks runs left 'running' for more than 30 minutes as failed", async () => {
      const [{ id }] = await sql`insert into sync_runs (trigger, started_at) values ('manual', now() - interval '31 minutes') returning id`;
      const [{ id: recent }] = await sql`insert into sync_runs (trigger, started_at) values ('manual', now() - interval '1 minute') returning id`;
      await sync.runSync("cli");
      const [row] = await sql`select status, finished_at from sync_runs where id = ${id}`;
      expect(row.status).toBe("failed");
      expect(row.finished_at).not.toBeNull();
      const [still] = await sql`select status from sync_runs where id = ${recent}`;
      expect(still.status).toBe("running");
      await sql`delete from sync_runs where id = ${recent}`;
    });

    it("keeps organizations whose icon is blocked even when they have no listings", async () => {
      await sql`insert into organizations (slug, name, logo_blocked) values ('blocked-org', 'Blocked Org', true), ('unused-org', 'Unused Org', false)`;
      await sync.runSync("cli");
      const rows = await sql`select slug from organizations where slug in ('blocked-org', 'unused-org')`;
      expect(rows.map((r: { slug: string }) => r.slug)).toEqual(["blocked-org"]);
    });

    it("stops reading a feed body once it passes the size cap", async () => {
      await expect(sync.fetchFeedText(`${base}/huge`, 10_000)).rejects.toThrow(/larger than 15 MB/);
    });
  });

  describe("rate limiting", () => {
    it("allows up to the limit in a window, then refuses", async () => {
      const key = `test|${Math.random()}`;
      expect(await limiter.rateLimit(key, 3, 60)).toBe(true);
      expect(await limiter.rateLimit(key, 3, 60)).toBe(true);
      expect(await limiter.rateLimit(key, 3, 60)).toBe(true);
      expect(await limiter.rateLimit(key, 3, 60)).toBe(false);
      expect(await limiter.rateLimit(`${key}-other`, 3, 60)).toBe(true);
    });

    it("stores only a hash of the key and deletes rows after 24 hours", async () => {
      const key = "track|203.0.113.7";
      await limiter.rateLimit(key, 10, 60);
      const rows = await sql`select key from rate_limits`;
      expect(rows.some((r: { key: string }) => r.key.includes("203.0.113.7"))).toBe(false);
      expect(rows.some((r: { key: string }) => r.key === limiter.hashKey(key))).toBe(true);

      await sql`insert into rate_limits (key, window_start, count) values ('old', now() - interval '25 hours', 1)`;
      await sql`insert into admin_login_failures (who, at) values ('old', now() - interval '25 hours')`;
      await limiter.cleanupRateLimits();
      expect((await sql`select 1 from rate_limits where key = 'old'`).length).toBe(0);
      expect((await sql`select 1 from admin_login_failures where who = 'old'`).length).toBe(0);
    });
  });

  describe("admin sessions", () => {
    beforeEach(() => {
      process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
      process.env.CRON_SECRET = CRON_SECRET;
    });

    it("accepts a fresh session and rejects tampered or expired ones", async () => {
      const s = await auth.createAdminSession();
      expect(s.maxAge).toBe(24 * 3600);
      expect(await auth.verifyAdminSession(s.value)).toBe(true);
      expect(auth.verifySessionValue(s.value)).toBe(true);
      expect(await auth.verifyAdminSession(s.value.slice(0, -2) + "xx")).toBe(false);
      const [v, ver, , sig] = s.value.split(".");
      expect(await auth.verifyAdminSession(`${v}.${ver}.${Date.now() + 10 * 86_400_000}.${sig}`)).toBe(false);
      expect(await auth.verifyAdminSession(undefined)).toBe(false);
    });

    it("cannot be forged with CRON_SECRET alone", async () => {
      const version = await auth.getSessionVersion();
      const payload = `v2.${version}.${Date.now() + 3_600_000}`;
      const forged = `${payload}.${createHmac("sha256", CRON_SECRET).update(payload).digest("base64url")}`;
      expect(await auth.verifyAdminSession(forged)).toBe(false);
    });

    it("ends every session when the password changes", async () => {
      const s = await auth.createAdminSession();
      process.env.ADMIN_PASSWORD = "a brand new password";
      expect(await auth.verifyAdminSession(s.value)).toBe(false);
      process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
      expect(await auth.verifyAdminSession(s.value)).toBe(true);
    });

    it("ends every session on sign-out (session version)", async () => {
      const s = await auth.createAdminSession();
      expect(await auth.verifyAdminSession(s.value)).toBe(true);
      await auth.revokeAllSessions();
      expect(await auth.verifyAdminSession(s.value)).toBe(false);
      // The fast signature-only check (used by the proxy) still passes; requireAdmin uses the full check.
      expect(auth.verifySessionValue(s.value)).toBe(true);
      const fresh = await auth.createAdminSession();
      expect(await auth.verifyAdminSession(fresh.value)).toBe(true);
    });
  });

  describe("API routes", () => {
    beforeEach(async () => {
      await sql`update locks set locked_until = null, holder = null`;
    });

    it("cron endpoints reject requests without the right secret", async () => {
      const syncRoute = await import("@/app/api/cron/sync/route");
      const digestRoute = await import("@/app/api/cron/digest/route");
      for (const handler of [syncRoute.GET, syncRoute.POST, digestRoute.GET, digestRoute.POST]) {
        expect((await handler(new Request("http://localhost/api/cron/x"))).status).toBe(401);
        const wrong = new Request("http://localhost/api/cron/x", { headers: { authorization: "Bearer wrong-secret-wrong-secret" } });
        expect((await handler(wrong)).status).toBe(401);
      }
      const ok = await syncRoute.GET(new Request("http://localhost/api/cron/sync", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
      expect(ok.status).toBe(200);
      expect((await ok.json()).runId).toBeGreaterThan(0);
    });

    it("/api/track drops private paths, strips query strings and rate-limits per IP", async () => {
      const { POST } = await import("@/app/api/track/route");
      const ip = "198.51.100.23";
      const send = (body: object, from = ip) =>
        POST(new Request("http://localhost/api/track", {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
            "x-nf-client-connection-ip": from,
            "x-forwarded-for": "1.2.3.4", // spoofed by the client; must be ignored
          },
        }));
      await sql`truncate events`;
      expect((await send({ type: "pageview", path: "/alerts/confirm?token=secret" })).status).toBe(204);
      expect((await send({ type: "pageview", path: "/admin/subscribers" })).status).toBe(204);
      expect((await send({ type: "pageview", path: `/account?t=${"a".repeat(64)}` })).status).toBe(204);
      expect((await send({ type: "pageview", path: "/jobs?q=data&utm_source=bing&msclkid=abc&email=a@b.c" })).status).toBe(204);
      const rows = await sql`select path from events`;
      expect(rows.map((r: { path: string }) => r.path)).toEqual(["/jobs?utm_source=bing&msclkid=abc"]);

      let last = 0;
      for (let i = 0; i < 125; i++) last = (await send({ type: "pageview", path: "/jobs" }, "198.51.100.99")).status;
      expect(last).toBe(429);
      expect((await send({ type: "pageview", path: "/jobs" }, "198.51.100.100")).status).toBe(204);
    });
  });
});
