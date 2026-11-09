/**
 * Resend answers (src/lib/email.ts): only a 2xx counts as sent. A 409 for a
 * request still in progress is retried once; a 409 for a key reused with a
 * different message is a failure. Resend is replaced by a stub.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { batchKey, sendBatch, sendEmail } from "@/lib/email";

type Reply = { status: number; body: Record<string, unknown> };
const replies: Reply[] = [];
const calls: { url: string; key?: string }[] = [];

const msg = { to: "someone@example.org", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
const conflict = (name: string) => ({ status: 409, body: { statusCode: 409, name, message: `${name} message` } });

describe("email sending (Resend answers)", () => {
  beforeAll(() => {
    process.env.RESEND_API_KEY = "re_test_stub";
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), key: (init?.headers as Record<string, string> | undefined)?.["Idempotency-Key"] });
      const r = replies.shift() ?? { status: 200, body: { id: "stub" } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.RESEND_API_KEY;
  });
  beforeEach(() => {
    replies.length = 0;
    calls.length = 0;
  });

  /** Runs a send while letting the 1-second retry wait pass instantly. */
  async function run<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return p;
  }

  it("counts a 2xx as sent", async () => {
    replies.push({ status: 200, body: { id: "em_1" } });
    expect(await run(sendEmail({ ...msg, idempotencyKey: "k:1" }))).toEqual({ ok: true, id: "em_1" });
    expect(calls).toHaveLength(1);
  });

  it("treats a reused key with a different message (invalid_idempotent_request) as failed, without retrying", async () => {
    replies.push(conflict("invalid_idempotent_request"));
    const res = await run(sendEmail({ ...msg, idempotencyKey: "k:2" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid_idempotent_request/);
    expect(calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/email not sent: Resend 409: .*invalid_idempotent_request/));
  });

  it("retries once with the same key while the first request is still in progress (concurrent_idempotent_requests)", async () => {
    replies.push(conflict("concurrent_idempotent_requests"), { status: 200, body: { id: "em_3" } });
    expect(await run(sendEmail({ ...msg, idempotencyKey: "k:3" }))).toEqual({ ok: true, id: "em_3" });
    expect(calls.map((c) => c.key)).toEqual(["k:3", "k:3"]);

    calls.length = 0;
    replies.push(conflict("concurrent_idempotent_requests"), conflict("concurrent_idempotent_requests"));
    const res = await run(sendEmail({ ...msg, idempotencyKey: "k:4" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/concurrent_idempotent_requests/);
    expect(calls).toHaveLength(2);
  });

  it("does not treat any other 409 as sent", async () => {
    replies.push({ status: 409, body: { name: "something_else", message: "idempotency something" } });
    expect((await run(sendEmail({ ...msg, idempotencyKey: "k:5" }))).ok).toBe(false);
  });

  it("batches: counts only 2xx as sent, retries a concurrent 409 once, fails an invalid one", async () => {
    const msgs = [msg, { ...msg, to: "other@example.org" }];
    replies.push({ status: 200, body: { data: [{ id: "a" }, { id: "b" }] } });
    expect(await run(sendBatch(msgs, () => "b:1"))).toEqual({ sent: 2, failed: 0, errors: [], delivered: [true, true] });

    replies.push(conflict("concurrent_idempotent_requests"), { status: 200, body: { data: [] } });
    expect(await run(sendBatch(msgs, () => "b:2"))).toMatchObject({ sent: 2, failed: 0 });

    calls.length = 0;
    replies.push(conflict("invalid_idempotent_request"));
    const res = await run(sendBatch(msgs, () => "b:3"));
    expect(res).toMatchObject({ sent: 0, failed: 2 });
    expect(res.errors[0]).toMatch(/invalid_idempotent_request/);
    expect(calls).toHaveLength(1);
  });

  it("a batch rejected with 422 is sent one by one, so one bad address doesn't block the others", async () => {
    const msgs = [
      { ...msg, to: "a@example.org", idempotencyKey: "digest:2026-W46:1" },
      { ...msg, to: "not-an-address" },
      { ...msg, to: "c@example.org", idempotencyKey: "digest:2026-W46:3" },
    ];
    const invalid = { status: 422, body: { statusCode: 422, name: "validation_error", message: "Invalid `to` field." } };
    replies.push(invalid, { status: 200, body: { id: "one" } }, invalid, { status: 200, body: { id: "three" } });
    const res = await run(sendBatch(msgs, () => "b:422"));
    expect(res).toMatchObject({ sent: 2, failed: 1, delivered: [true, false, true] });
    expect(res.errors).toEqual(["Invalid `to` field."]);
    // The batch request, then one request per message: each message's own key, or one
    // derived from the batch key and the recipient. A 422 is not retried.
    expect(calls.map((c) => [c.url, c.key])).toEqual([
      ["https://api.resend.com/emails/batch", "b:422"],
      ["https://api.resend.com/emails", "digest:2026-W46:1"],
      ["https://api.resend.com/emails", "b:422:not-an-address"],
      ["https://api.resend.com/emails", "digest:2026-W46:3"],
    ]);

    // Other failures are not split up: the whole chunk failed.
    calls.length = 0;
    replies.push({ status: 500, body: { name: "internal_server_error", message: "down" } }, { status: 500, body: { name: "internal_server_error", message: "down" } });
    expect(await run(sendBatch(msgs, () => "b:500"))).toMatchObject({ sent: 0, failed: 3, delivered: [false, false, false] });
    expect(calls.every((c) => c.url.endsWith("/emails/batch"))).toBe(true);
  });

  it("batch keys depend on the messages' own keys", () => {
    const a = batchKey("digest:2026-W46", ["digest:2026-W46:1", "digest:2026-W46:2"]);
    expect(a).toMatch(/^digest:2026-W46:[0-9a-f]{40}$/);
    expect(batchKey("digest:2026-W46", ["digest:2026-W46:1", "digest:2026-W46:2"])).toBe(a);
    expect(batchKey("digest:2026-W46", ["digest:2026-W46:1", "digest:2026-W46:3"])).not.toBe(a);
  });
});
