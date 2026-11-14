import { describe, expect, it } from "vitest";
import { capiBody, parseMetaMatch, sha256 } from "@/lib/meta-capi";

describe("Meta Conversions API", () => {
  it("reads the match field only when it carries an event id", () => {
    expect(parseMetaMatch("")).toBeNull();
    expect(parseMetaMatch("not json")).toBeNull();
    expect(parseMetaMatch(JSON.stringify({ fbp: "fb.1.1700000000000.123456789" }))).toBeNull();
    const m = parseMetaMatch(JSON.stringify({ eventId: "3f6b2a1e-8c4d-4b7a-9e21-5d0c7a9f1b24", fbc: "fb.1.1700000000000.IwAR123abcdefg", fbp: "fb.1.1700000000000.123456789", url: "https://postbird.nuevanova.com/alerts" }));
    expect(m).toMatchObject({ eventId: "3f6b2a1e-8c4d-4b7a-9e21-5d0c7a9f1b24", fbc: "fb.1.1700000000000.IwAR123abcdefg", fbp: "fb.1.1700000000000.123456789" });
  });
  it("drops malformed click and browser ids", () => {
    const m = parseMetaMatch(JSON.stringify({ eventId: "abcdefgh12", fbc: "<script>", fbp: "x", url: "javascript:alert(1)" }));
    expect(m).toEqual({ eventId: "abcdefgh12", fbc: undefined, fbp: undefined, url: undefined });
  });
  it("hashes the email address and never sends it in plain text", () => {
    const body = capiBody({ event: "Lead", match: { eventId: "abcdefgh12" }, email: " Someone@Example.com ", ip: "1.2.3.4", ua: "UA", now: 1_700_000_000_000 });
    const ev = body.data[0];
    expect(ev).toMatchObject({ event_name: "Lead", event_id: "abcdefgh12", action_source: "website", event_time: 1_700_000_000 });
    expect(ev.user_data.em).toEqual([sha256("someone@example.com")]);
    expect(JSON.stringify(body)).not.toContain("example.com");
  });
  it("adds the value only for a purchase with a currency", () => {
    expect(capiBody({ event: "Purchase", match: { eventId: "abcdefgh12" }, value: 19.99, currency: "USD" }).data[0].custom_data).toEqual({ value: 19.99, currency: "USD" });
    expect(capiBody({ event: "StartTrial", match: { eventId: "abcdefgh12" } }).data[0]).not.toHaveProperty("custom_data");
  });
});
