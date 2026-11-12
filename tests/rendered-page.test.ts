import { describe, expect, it } from "vitest";
import { looksBuiltByScript, visibleTextLength } from "@/lib/feeds/rendered-page";

describe("pages built with JavaScript", () => {
  it("spots an empty shell that loads scripts", () => {
    expect(looksBuiltByScript('<html><body><div id="root"></div><script src="/app.js"></script></body></html>')).toBe(true);
  });
  it("leaves a page with real text alone", () => {
    const text = "Programme Officer, Nairobi. ".repeat(20);
    expect(looksBuiltByScript(`<html><body><p>${text}</p><script>1</script></body></html>`)).toBe(false);
  });
  it("doesn't count script or style text as visible", () => {
    expect(visibleTextLength("<style>p{color:red}</style><script>var a = 'long text here'</script><p>Hi</p>")).toBe(2);
  });
});
