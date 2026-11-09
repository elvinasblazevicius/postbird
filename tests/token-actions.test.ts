/**
 * Actions opened from a link with a token (account page, confirm, unsubscribe): a database error
 * gives the usual "something went wrong" reply instead of an error page. The lookups are stubbed
 * to fail; no database needed.
 */
import { describe, expect, it, vi } from "vitest";

const down = () => Promise.reject(new Error("connection refused"));
vi.mock("@/lib/account", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/account")>()), findByManageToken: down }));
vi.mock("@/lib/subscribers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscribers")>()),
  confirmSubscriber: down, unsubscribe: down, findByUnsubscribeToken: down,
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));

const SERVER_ERROR = { status: "error", message: "Something went wrong on our side. Please try again in a minute." };

describe("token actions when the database fails", () => {
  it("answer with the server-error reply", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const billing = await import("@/app/billing-actions");
    const actions = await import("@/app/actions");
    const idle = { status: "idle" as const, message: "" };
    const fd = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };
    const t = "a".repeat(64);
    expect(await billing.frequencyAction(idle, fd({ t, frequency: "weekly" }))).toEqual(SERVER_ERROR);
    expect(await billing.removeSearchAction(idle, fd({ t, id: "3" }))).toEqual(SERVER_ERROR);
    expect(await billing.accountUnsubscribeAction(idle, fd({ t }))).toEqual(SERVER_ERROR);
    expect(await billing.resubscribeAction(idle, fd({ t }))).toEqual(SERVER_ERROR);
    expect(await billing.addSearchAction(idle, fd({ t, link: "/jobs?q=nurse" }))).toEqual(SERVER_ERROR);
    expect(await billing.portalAction(idle, fd({ t }))).toEqual(SERVER_ERROR);
    expect(await billing.unsubscribeCancelLinkAction(idle, fd({ token: "b".repeat(32) }))).toEqual(SERVER_ERROR);
    expect(await actions.confirmAction(idle, fd({ token: "c".repeat(32) }))).toEqual(SERVER_ERROR);
    expect(await actions.unsubscribeAction(idle, fd({ token: "d".repeat(32) }))).toEqual(SERVER_ERROR);
  });
});
