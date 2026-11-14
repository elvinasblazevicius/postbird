import { sql } from "@/lib/db";

type Quote = { id: number; message: string; display_name: string };

/**
 * Words subscribers sent from /share, agreed to be quoted and approved in Admin → Feedback, as
 * written. Nothing is shown until there is at least one (never invented or placeholder quotes).
 */
export async function Testimonials({ limit = 3, className = "" }: { limit?: number; className?: string }) {
  const rows = await sql<Quote[]>`
    select id::int as id, message, display_name from feedback
     where kind = 'testimonial' and quote_ok and approved_at is not null and display_name is not null
     order by approved_at desc limit ${limit}`.catch(() => [] as Quote[]);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="testimonials-heading" className={className}>
      <h2 id="testimonials-heading" className="font-display text-2xl text-ink">What subscribers say</h2>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((q) => (
          <li key={q.id}>
            <figure className="h-full rounded-xl border border-rule bg-paper p-5">
              <blockquote className="whitespace-pre-line text-[0.98rem] leading-relaxed text-ink">&ldquo;{q.message}&rdquo;</blockquote>
              <figcaption className="mt-3 text-sm text-slate">{q.display_name}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
