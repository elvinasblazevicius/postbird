import Link from "next/link";
import { ORG_TYPES } from "@/config/regions";
import { listName } from "@/lib/coverage";
import { EMPLOYER_TYPE_PAGES } from "@/lib/employer-types";
import { jobsUrl, type WeekInReview } from "@/lib/jobs";

/** Below this many new open listings in the past 7 days the strip isn't shown. */
export const WEEK_IN_REVIEW_MIN = 10;

/**
 * "This week in international jobs" on the home page: how many open vacancies were posted in the
 * past 7 days, by employer type, and the three organizations with the most. Every number is
 * computed from the listings (weekInReview in src/lib/jobs.ts) and links to the same list
 * (the "posted in the past week" filter). Hidden while there are fewer than WEEK_IN_REVIEW_MIN.
 */
export function WeekInReviewStrip({ week }: { week: WeekInReview }) {
  if (week.total < WEEK_IN_REVIEW_MIN) return null;
  const types = week.types
    .map((t) => {
      const value = ORG_TYPES.find((o) => o.type === t.type)?.value;
      const page = EMPLOYER_TYPE_PAGES.find((p) => p.orgtype === value);
      return value && page ? { value, label: page.label, count: t.count } : null;
    })
    .filter((t): t is { value: string; label: string; count: number } => t !== null);
  const item = "whitespace-nowrap";
  const link = "font-medium text-accent hover:underline";
  return (
    <section className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-10" aria-labelledby="week-heading">
      <div className="rounded-xl border border-rule bg-paper px-4 py-4 sm:px-6 sm:py-5">
        <h2 id="week-heading" className="text-[1.3rem] font-semibold leading-tight text-ink">This week in international jobs</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,14rem)_1fr_1fr] md:gap-8">
          <p className="text-[0.95rem] leading-snug text-slate">
            <Link href={jobsUrl({ posted: "7" })} className="group block text-ink">
              <span className="block font-display text-[2rem] font-semibold leading-none group-hover:text-accent">{week.total.toLocaleString("en-US")}</span>
              <span className="mt-1 block text-[0.95rem] font-normal text-slate group-hover:underline">open vacancies posted in the past 7 days</span>
            </Link>
          </p>
          {types.length ? (
            <div>
              <h3 className="font-sans text-sm font-medium text-slate">By employer type</h3>
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.95rem]">
                {types.map((t) => (
                  <li key={t.value} className={item}>
                    <Link href={jobsUrl({ orgtype: t.value, posted: "7" })} className={link}>{t.label}</Link>{" "}
                    <span className="tabular-nums text-slate">{t.count.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {week.orgs.length ? (
            <div>
              <h3 className="font-sans text-sm font-medium text-slate">Most new vacancies</h3>
              <ol className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.95rem]">
                {week.orgs.map((o) => (
                  <li key={o.slug}>
                    <Link href={jobsUrl({ org: o.slug, posted: "7" })} className={link}>{listName(o.name, o.short_name)}</Link>{" "}
                    <span className="whitespace-nowrap tabular-nums text-slate">{o.count.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
