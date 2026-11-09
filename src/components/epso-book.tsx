import { TrackedLink } from "./tracking";

/**
 * The owner's EPSO workbook, shown only where it is relevant: EU institution
 * organization pages and job pages of EU institutions. The link is a
 * books2read universal link, which sends each visitor to their local Amazon store.
 * The disclosure line is required: it is our own product, not an independent recommendation.
 */
export const EPSO_BOOK = {
  title: "Reasoning Tests Workbook for EPSO Exams",
  author: "Concours Prep",
  url: "https://books2read.com/u/4E5GQl",
  cover: "/books/epso-reasoning-tests.jpg",
  blurb: "400+ practice questions in verbal, numerical and abstract reasoning and situational judgement, with 3 timed mock exams and worked solutions.",
};

export function isEuInstitution(orgType: string | null | undefined) {
  return orgType === "EU institution";
}

export function EpsoBook({ className = "", source }: { className?: string; source: string }) {
  return (
    <aside aria-label="EPSO test preparation" className={`flex gap-4 rounded-xl border border-rule bg-paper p-4 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={EPSO_BOOK.cover} alt="" width={64} height={102} className="h-[102px] w-16 shrink-0 rounded shadow-sm" loading="lazy" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate">Preparing for EPSO tests?</p>
        <p className="mt-0.5 font-semibold leading-snug text-ink">
          <TrackedLink href={EPSO_BOOK.url} event="book_click" source={source} target="_blank" rel="sponsored noopener" className="text-accent underline">{EPSO_BOOK.title}</TrackedLink>
          <span className="font-normal text-slate"> by {EPSO_BOOK.author}, on Amazon</span>
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate">{EPSO_BOOK.blurb}</p>
        <p className="mt-1.5 text-xs text-slate">Postbird earns from sales of this book.</p>
      </div>
    </aside>
  );
}
