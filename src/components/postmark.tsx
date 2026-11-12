import { formatShortDate, relativeDeadline } from "@/lib/site";

/**
 * The words of the closing-date stamp on a vacancy's share image (src/lib/og.tsx): "Closes /
 * 12 Nov", with the year under it, or "in 3 days" (and the closing-soon red) when it is close.
 * Null without a published closing date.
 */
export function closingStamp(deadline: string | null, size: "sm" | "lg" = "sm"): { top: string; main: string; bottom: string | null; urgent: boolean } | null {
  if (!deadline) return null;
  const rel = relativeDeadline(deadline);
  const urgent = Boolean(rel?.urgent);
  const short = formatShortDate(deadline);
  // "12 Jan 2027" → "12 Jan" with "2027" on its own line; a close date needs no year.
  const m = short.match(/^(\d{1,2} \w{3})(?: (\d{4}))?$/);
  const dayMonth = m ? m[1] : short;
  const year = size === "lg" ? deadline.slice(0, 4) : (m?.[2] ?? null);
  return { top: "Closes", main: dayMonth, bottom: rel && urgent ? rel.text : year, urgent };
}
