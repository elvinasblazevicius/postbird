import { sql } from "@/lib/db";
import { requireAdmin } from "../guard";
import { AdminShell, fmtDateTime, Table } from "../ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { feature: "Feature", problem: "Problem", other: "Other" };

/** Messages from /feedback, newest first. */
export default async function AdminFeedbackPage() {
  await requireAdmin();
  const rows = await sql<{ id: number; kind: string; message: string; email: string | null; page: string | null; created_at: Date }[]>`
    select id::int as id, kind, message, email, page, created_at from feedback order by created_at desc limit 300`;
  return (
    <AdminShell title="Feedback" active="/admin/feedback">
      <p className="text-sm text-slate">Feature requests and other messages from the &ldquo;Suggest a feature&rdquo; page. Each one is also emailed to the contact address.</p>
      <div className="mt-4">
        <Table head={["When", "About", "Message", "Reply to", "Page"]}>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-slate">{fmtDateTime(r.created_at)}</td>
              <td className="px-4 py-3">{KIND[r.kind] ?? r.kind}</td>
              <td className="max-w-lg whitespace-pre-wrap px-4 py-3 text-ink">{r.message}</td>
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
