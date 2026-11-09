import { formatShortDate, relativeDeadline } from "@/lib/site";

/**
 * Postbird's one signature element: a postmark, the round date stamp a post office sets on a
 * letter. Used for dates only (a vacancy's closing date on cards and on the job page, the date
 * a week's digest runs to), so it always means "this is when". Static: no motion. The ring and
 * text use the postmark ink (or the closing-soon red when `urgent`); see .postmark in globals.css.
 */
export function Postmark({ top, main, bottom, urgent = false, size = "sm", waves = false, className = "" }: {
  top: string;
  main: string;
  bottom?: string | null;
  urgent?: boolean;
  size?: "sm" | "lg";
  /** The wavy cancellation lines beside the ring (only where there is room for them). */
  waves?: boolean;
  className?: string;
}) {
  return (
    <span className={`postmark postmark-${size} ${urgent ? "postmark-urgent" : ""} ${className}`}>
      {waves ? (
        <svg viewBox="0 0 40 30" className="postmark-waves" aria-hidden="true" focusable="false">
          {[7, 15, 23].map((y) => (
            <path key={y} d={`M0 ${y}c3.3-3 6.7-3 10 0s6.7 3 10 0 6.7-3 10 0 6.7 3 10 0`} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          ))}
        </svg>
      ) : null}
      <span className="postmark-ring">
        <span className="postmark-top">{top}</span>
        <span className="postmark-main">{main}</span>
        {bottom ? <span className="postmark-bottom">{bottom}</span> : null}
      </span>
    </span>
  );
}

/**
 * A closing date as a postmark: "Closes / 12 Nov", with the year under it when it isn't this year,
 * or "in 3 days" (and the closing-soon red) when it is close. Null without a published closing date.
 */
export function ClosingPostmark({ deadline, size = "sm", waves = false, className = "" }: { deadline: string | null; size?: "sm" | "lg"; waves?: boolean; className?: string }) {
  if (!deadline) return null;
  const rel = relativeDeadline(deadline);
  const urgent = Boolean(rel?.urgent);
  const short = formatShortDate(deadline);
  // "12 Jan 2027" → "12 Jan" with "2027" on its own line; a close date needs no year. The large
  // stamp always shows the year.
  const m = short.match(/^(\d{1,2} \w{3})(?: (\d{4}))?$/);
  const dayMonth = m ? m[1] : short;
  const year = size === "lg" ? deadline.slice(0, 4) : (m?.[2] ?? null);
  const bottom = rel && urgent ? rel.text : year;
  return <Postmark top="Closes" main={dayMonth} bottom={bottom} urgent={urgent} size={size} waves={waves} className={className} />;
}
