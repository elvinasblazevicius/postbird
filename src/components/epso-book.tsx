import siteConfig from "@site-config";
import { TrackedLink } from "./tracking";

/**
 * The owner's EPSO workbook, shown only where it is relevant: the EU jobs page, EU institution
 * organization pages and job pages of EU institutions. The button goes through /api/book/epso,
 * which sends each visitor to the book on the Amazon store for their country.
 * The disclosure is required: it is our own product, not an independent recommendation.
 */
export const EPSO_BOOK = {
  title: "Reasoning Tests Workbook for EPSO Exams",
  author: "Concours Prep",
  asin: "B0HP6MWFDB",
  href: "/api/book/epso",
  cover: "/books/epso-reasoning-tests.jpg",
  blurb: "400+ practice questions in verbal, numerical and abstract reasoning and situational judgement, with 3 timed mock exams and worked solutions.",
};

export function isEuInstitution(orgType: string | null | undefined) {
  return orgType === "EU institution";
}

export function EpsoBook({ className = "", source }: { className?: string; source: string }) {
  return (
    <aside aria-label="EPSO test preparation" className={`flex flex-wrap items-center gap-x-5 gap-y-4 rounded-xl border border-rule bg-paper p-4 sm:p-5 ${className}`}>
      <div className="flex min-w-0 flex-[999_1_20rem] gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={EPSO_BOOK.cover} alt="" width={80} height={128} className="h-32 w-20 shrink-0 rounded shadow-sm" loading="lazy" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-tint-ink">Preparing for EPSO tests?</p>
          <p className="mt-0.5 text-[1.05rem] font-bold leading-snug text-ink">{EPSO_BOOK.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-tint-ink">{EPSO_BOOK.blurb}</p>
          <p className="mt-2 text-[0.8125rem] leading-snug text-slate">
            Our own book, by {EPSO_BOOK.author}, published by {siteConfig.operator.name}, which runs {siteConfig.name}. We earn from each sale. Not affiliated with or endorsed by EPSO or the EU institutions.
          </p>
        </div>
      </div>
      <TrackedLink
        href={EPSO_BOOK.href}
        event="book_click"
        source={source}
        target="_blank"
        rel="sponsored nofollow noopener"
        className="inline-flex min-h-11 flex-[1_0_auto] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-brand px-5 text-[0.95rem] font-bold text-accent no-underline hover:bg-mist"
      >
        See it on Amazon
        <span className="sr-only"> (opens Amazon in a new tab)</span>
        <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
      </TrackedLink>
    </aside>
  );
}
