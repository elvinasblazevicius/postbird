/**
 * Reads vacancy pages that are built in the browser (the HTML the server sends is an empty shell
 * and the text arrives through JavaScript). Used by the vacancy-page step only for pages whose
 * plain HTML had almost no text, and only where a browser is installed: the scheduled import on
 * GitHub installs Playwright's Chromium for this; elsewhere (tests, the website) there is none
 * and the step carries on without it.
 *
 * Same manners as the plain reader: robots.txt has already allowed the page, the browser
 * introduces itself with our named user agent, images, fonts and media are not downloaded,
 * and a page that refuses us (403, 429, a "checking your browser" wall) is left alone.
 * Nothing is clicked, typed or solved.
 */
import { IMPORT_SETTINGS } from "@/config/import";

const S = IMPORT_SETTINGS.vacancyPages;

/** Visible text in an HTML page, roughly (scripts, styles and tags removed). */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** A page whose HTML carries almost no text but does load scripts: built in the browser. */
export function looksBuiltByScript(html: string): boolean {
  return visibleTextLength(html) < 300 && /<script\b/i.test(html);
}

const WALL = /checking your browser|verify you are human|enable javascript and cookies|attention required|access denied|captcha/i;

export type Renderer = { render(url: string): Promise<string | null>; close(): Promise<void> };

// Only the few calls used here, so the module type-checks without Playwright installed.
type PwPage = {
  route(pattern: string, handler: (route: { request(): { resourceType(): string }; abort(): Promise<void>; continue(): Promise<void> }) => unknown): Promise<void>;
  goto(url: string, o: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>;
  waitForLoadState(state: string, o: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  close(): Promise<void>;
};
type PwBrowser = { newContext(o: Record<string, unknown>): Promise<{ newPage(): Promise<PwPage>; close(): Promise<void> }>; close(): Promise<void> };

/** A headless browser, or null when none is installed here. */
export async function openRenderer(): Promise<Renderer | null> {
  let browser: PwBrowser;
  try {
    const name = "playwright"; // not a dependency of the site: installed only by the scheduled import
    const pw = (await import(/* webpackIgnore: true */ name)) as { chromium: { launch(o: Record<string, unknown>): Promise<PwBrowser> } };
    browser = await pw.chromium.launch({ headless: true });
  } catch {
    return null;
  }
  const context = await browser.newContext({ userAgent: S.userAgent, locale: "en", javaScriptEnabled: true });
  return {
    async render(url: string) {
      const page = await context.newPage();
      try {
        await page.route("**/*", (route) =>
          ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue());
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: S.timeoutMs });
        if (!res || res.status() >= 400) return null;
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        const html = await page.content();
        if (html.length > S.maxBytes) return null;
        if (WALL.test(html.slice(0, 20_000)) && visibleTextLength(html) < 1500) return null;
        return html;
      } catch {
        return null;
      } finally {
        await page.close().catch(() => {});
      }
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
