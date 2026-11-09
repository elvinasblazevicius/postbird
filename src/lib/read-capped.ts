/** Reading a request body with a size limit (server only). */

/**
 * The body as text, or null once it passes `max` bytes: read piece by piece
 * and stopped there, so an oversized body (or one without a Content-Length)
 * is never held in memory in full.
 */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
