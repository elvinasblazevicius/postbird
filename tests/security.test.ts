/** Unit tests for the security helpers that need no database. */
import { afterEach, describe, expect, it } from "vitest";
import { GET as calendar } from "@/app/api/calendar/[id]/route";
import { GET as geo } from "@/app/api/geo/route";
import { GET as saved } from "@/app/api/saved/route";
import { GET as unsubscribeGet } from "@/app/api/unsubscribe/route";
import { cleanTrackedPath } from "@/app/api/track/clean-path";
import robots from "@/app/robots";
import { clientIp, hashKey } from "@/lib/rate-limit";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { parseId } from "@/lib/site";

describe("clientIp", () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  it("prefers Netlify's connection IP over anything the client sends", () => {
    const h = new Headers({ "x-nf-client-connection-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1, 203.0.113.5" });
    expect(clientIp(h)).toBe("203.0.113.5");
  });

  it("uses the last X-Forwarded-For hop (added by the proxy), never the first", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("trusts x-real-ip only on Vercel", () => {
    const h = new Headers({ "x-real-ip": "192.0.2.9", "x-forwarded-for": "192.0.2.10" });
    expect(clientIp(h)).toBe("192.0.2.10");
    process.env.VERCEL = "1";
    expect(clientIp(h)).toBe("192.0.2.9");
  });

  it("falls back to 'unknown'", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("hashes keys one-way", () => {
    expect(hashKey("track|203.0.113.5")).not.toContain("203.0.113.5");
    expect(hashKey("a")).toBe(hashKey("a"));
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });
});

describe("cleanTrackedPath", () => {
  it("keeps only campaign parameters", () => {
    expect(cleanTrackedPath("/jobs?q=data&utm_source=bing&utm_campaign=x&msclkid=1&email=a%40b.c#top"))
      .toBe("/jobs?utm_source=bing&utm_campaign=x&msclkid=1");
    expect(cleanTrackedPath("/jobs/123-data-analyst")).toBe("/jobs/123-data-analyst");
  });

  it("refuses admin pages and alert links", () => {
    expect(cleanTrackedPath("/alerts/confirm?token=abc")).toBe(false);
    expect(cleanTrackedPath("/alerts/unsubscribe?token=abc")).toBe(false);
    expect(cleanTrackedPath("/admin")).toBe(false);
    expect(cleanTrackedPath("/admin/subscribers")).toBe(false);
    expect(cleanTrackedPath("/alerts")).toBe("/alerts");
  });

  it("ignores values that are not same-site paths", () => {
    expect(cleanTrackedPath("https://evil.example/x")).toBeNull();
    expect(cleanTrackedPath("//evil.example/x")).toBeNull();
    expect(cleanTrackedPath(42)).toBeNull();
  });
});

describe("/api/geo", () => {
  const call = async (headers: Record<string, string>) => {
    const res = geo(new Request("http://localhost/api/geo", { headers }));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    return res.json();
  };

  it("reads Netlify's base64 or plain JSON header", async () => {
    const b64 = Buffer.from(JSON.stringify({ country: { code: "DE", name: "Germany" } })).toString("base64");
    expect(await call({ "x-nf-geo": b64 })).toEqual({ country: "DE", consentRequired: true });
    expect(await call({ "x-nf-geo": JSON.stringify({ country: { code: "US" } }) })).toEqual({ country: "US", consentRequired: false });
  });

  it("reads Vercel's header and covers EEA, UK and Switzerland", async () => {
    expect(await call({ "x-vercel-ip-country": "vn" })).toEqual({ country: "VN", consentRequired: false });
    for (const c of ["NO", "IS", "LI", "GB", "CH", "FR"]) expect((await call({ "x-vercel-ip-country": c })).consentRequired).toBe(true);
  });

  it("requires consent when the country is unknown", async () => {
    expect(await call({})).toEqual({ country: null, consentRequired: true });
    expect(await call({ "x-nf-geo": "not-json" })).toEqual({ country: null, consentRequired: true });
  });
});

describe("cron auth", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("needs the exact bearer secret", () => {
    process.env.CRON_SECRET = "s".repeat(32);
    const req = (auth?: string) => new Request("http://localhost/api/cron/sync", { headers: auth ? { authorization: auth } : {} });
    expect(isAuthorizedCron(req())).toBe(false);
    expect(isAuthorizedCron(req("Bearer wrong"))).toBe(false);
    expect(isAuthorizedCron(req(`Bearer ${"s".repeat(31)}`))).toBe(false);
    expect(isAuthorizedCron(req(`Bearer ${"s".repeat(32)}`))).toBe(true);
  });

  it("is off when CRON_SECRET is missing or short", () => {
    process.env.CRON_SECRET = "short";
    expect(isAuthorizedCron(new Request("http://localhost/", { headers: { authorization: "Bearer short" } }))).toBe(false);
  });
});

describe("robots.txt", () => {
  it("lets crawlers fetch organization icons but nothing else under /api/", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toContain("/api/org-logo/");
    expect(rule.disallow).toContain("/api/");
  });
});

describe("calendar route", () => {
  it("answers 404 for ids that aren't 1 to 12 digits, without asking the database", async () => {
    for (const id of ["99999999999999999999.ics", "9223372036854775808", "1234567890123", "0", "1e3", "-5", "12abc.ics", ""]) {
      const res = await calendar(new Request(`http://localhost/api/calendar/${id}`), { params: Promise.resolve({ id }) });
      expect(res.status, id).toBe(404);
    }
  });
});

describe("ids from forms and query strings", () => {
  it("parseId accepts 1 to 12 digits above 0 only", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId("999999999999")).toBe(999_999_999_999);
    for (const v of ["1234567890123", "99999999999999999999", "9223372036854775808", "0", "000", "1e3", "-5", "1.5", " 7", "abc", "", null, undefined, 12]) {
      expect(parseId(v), String(v)).toBeNull();
    }
  });

  it("/api/saved answers 400 for an oversized id, without asking the database", async () => {
    for (const ids of ["99999999999999999999", "12,1234567890123", "0"]) {
      const res = await saved(new Request(`http://localhost/api/saved?ids=${ids}`));
      expect(res.status, ids).toBe(400);
    }
  });
});

describe("one-click unsubscribe address opened with GET", () => {
  it("redirects (303) to the unsubscribe page with the token, and unsubscribes nobody", async () => {
    const res = await unsubscribeGet(new Request("http://localhost/api/unsubscribe?token=abc_DEF-123"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/alerts/unsubscribe?token=abc_DEF-123");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const odd = await unsubscribeGet(new Request("http://localhost/api/unsubscribe?token=a%26b%3Dc"));
    expect(odd.headers.get("location")).toBe("/alerts/unsubscribe?token=a%26b%3Dc");
    expect((await unsubscribeGet(new Request("http://localhost/api/unsubscribe"))).headers.get("location")).toBe("/alerts/unsubscribe");
  });
});

describe("control characters and malformed tokens never reach the database", () => {
  it("normalizeEmail rejects control characters (NUL, line breaks) inside an address", async () => {
    const { normalizeEmail } = await import("@/lib/subscribers");
    expect(normalizeEmail(" Someone@Example.org ")).toBe("someone@example.org");
    expect(normalizeEmail("some\u0000one@example.org")).toBeNull();
    expect(normalizeEmail("someone@example.org\r\nBcc: x@example.org")).toBeNull();
    expect(normalizeEmail("some\u007fone@example.org")).toBeNull();
    expect(normalizeEmail(["a@example.org"] as unknown as string)).toBeNull();
  });

  it("link tokens must look like the ones the site creates before anything is looked up", async () => {
    const { isLinkToken, findByUnsubscribeToken, findByConfirmToken, confirmSubscriber, unsubscribe } = await import("@/lib/subscribers");
    expect(isLinkToken("abcDEF0123456789_-abcdefghijklmn")).toBe(true);
    for (const bad of ["", "short", "a".repeat(65), "a".repeat(31) + "\u0000", "a".repeat(30) + "%00", "a b".repeat(10), ["a".repeat(32)], null, 42]) {
      expect(isLinkToken(bad), String(bad)).toBe(false);
    }
    // No DATABASE_URL here: these return before any query (a query would throw).
    expect(await findByUnsubscribeToken("\u0000".repeat(32))).toBeNull();
    expect(await findByConfirmToken(["a".repeat(32)])).toBeNull();
    expect(await confirmSubscriber("x")).toEqual({ ok: false });
    expect(await unsubscribe("a".repeat(31) + "\u0000")).toBeNull();
  });

  it("job filters from the URL lose control characters (/jobs?q=%00)", async () => {
    const { parseFilters } = await import("@/lib/jobs");
    expect(parseFilters({ q: "\u0000" }).q).toBeUndefined();
    expect(parseFilters({ q: "data\u0000analyst\u001f" }).q).toBe("data analyst");
    expect(parseFilters({ q: decodeURIComponent("%00nurse") }).q).toBe("nurse");
    expect(parseFilters({ org: "unicef\u0000x" }).org).toBeUndefined();
    expect(parseFilters({ page: "2\u0000" }).page).toBe(2);
    const { getOrganization } = await import("@/lib/jobs");
    expect(await getOrganization("unicef\u0000")).toBeNull();
  });
});

describe("database client", () => {
  it("never pipelines queries and has a client-side query time limit", async () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5999/never_connected";
    try {
      const { getSql } = await import("@/lib/db");
      const sql = getSql() as unknown as { options: { max_pipeline: number; query_timeout: number; max: number; prepare: boolean } };
      expect(sql.options.max_pipeline).toBe(1);
      expect(sql.options.query_timeout).toBe(12);
      expect(sql.options.max).toBeGreaterThanOrEqual(5);
      expect(sql.options.prepare).toBe(false);
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });
});

describe("coverage line", () => {
  it("names up to four well-known organizations with open vacancies, and hides below 5", async () => {
    const { coverageFrom, joinNames } = await import("@/lib/coverage");
    const org = (name: string, short_name: string | null, count: number) => ({ name, short_name, count });
    expect(coverageFrom([org("UNICEF", "UNICEF", 9), org("A", null, 1), org("B", null, 1), org("C", null, 1)])).toBeNull();
    const c = coverageFrom([
      org("Small Org", null, 1), org("World Health Organization", "WHO", 30), org("UNICEF", "UNICEF", 50), org("UNDP", "UNDP", 20),
      org("International Organization for Migration", "IOM", 10), org("UN Women", "UN Women", 5), org("Very Long Organization", "VERYLONGSHORTNAME", 40),
    ]);
    expect(c).toEqual({ count: 7, names: ["UNICEF", "WHO", "UNDP", "IOM"] });
    expect(joinNames(c!.names)).toBe("UNICEF, WHO, UNDP and IOM");
    expect(coverageFrom([org("Alpha Org", null, 3), org("Beta Org", null, 2), org("Gamma Org", null, 1), org("D", null, 1), org("E", "E", 1)])?.names)
      .toEqual(["Alpha Org", "Beta Org", "Gamma Org"]);
    // Ambiguous or little-known acronyms give way to full names ("DRC" is also a country).
    expect(coverageFrom([
      org("Danish Refugee Council", "DRC", 40), org("UNICEF", "UNICEF", 30), org("International Rescue Committee", "IRC", 20), org("A", null, 1), org("B", null, 1),
    ])?.names).toEqual(["UNICEF", "Danish Refugee Council", "International Rescue Committee"]);
  });
});
