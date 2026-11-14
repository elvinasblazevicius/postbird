import { sql } from "@/lib/db";
import { approveTestimonialAction } from "../actions";
import { requireAdmin } from "../guard";
import { AdminShell, fmtDateTime, Table } from "../ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { feature: "Feature", problem: "Problem", other: "Other", contact: "Contact form", testimonial: "Experience" };

/** Messages from /feedback, newest first. */
export default async function AdminFeedbackPage() {
  await requireAdmin();
  const rows = await sql<{ id: number; kind: string; message: string; email: string | null; page: string | null; created_at: Date; display_name: string | null; quote_ok: boolean; approved_at: Date | null }[]>`
    select id::int as id, kind, message, email, page, created_at, display_name, quote_ok, approved_at from feedback order by created_at desc limit 300`;
  return (
    <AdminShell title="Feedback" active="/admin/feedback">
      <p className="text-sm text-slate">
        Messages from the &ldquo;Suggest a feature&rdquo;, Contact and &ldquo;Share your experience&rdquo; pages, each also emailed to the contact address.
        An experience its author agreed to have quoted can be shown on the home and pricing pages: press &ldquo;Show on site&rdquo;. Nothing else is ever shown.
      </p>
      <div className="mt-4">
        <Table head={["When", "About", "Message", "Reply to", "Page"]}>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-slate">{fmtDateTime(r.created_at)}</td>
              <td className="px-4 py-3">{KIND[r.kind] ?? r.kind}</td>
              <td className="max-w-lg whitespace-pre-wrap px-4 py-3 text-ink">
                {r.message}
                {r.kind === "testimonial" ? (
                  <div className="mt-2 text-xs text-slate">
                    {r.display_name ? <>Name to show: {r.display_name} · </> : null}
                    {r.quote_ok ? "May be quoted" : "Not for quoting"}
                    {r.quote_ok && r.display_name ? (
                      <form action={approveTestimonialAction} className="mt-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="show" value={r.approved_at ? "0" : "1"} />
                        <button className={`rounded-md px-3 py-1.5 text-sm font-semibold ${r.approved_at ? "border border-rule text-ink hover:bg-mist" : "bg-brand text-white hover:bg-accent"}`}>
                          {r.approved_at ? "Shown on site: hide" : "Show on site"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-slate">{r.email ?? "—"}</td>
              <td className="px-4 py-3 text-slate">{r.page ?? "—"}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 ? <p className="mt-3 text-sm text-slate">No messages yet.</p> : null}
      </div>
    </AdminShell>
  );
}
