import Link from "next/link";
import { logoutAction } from "./actions";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/feeds", label: "Feeds" },
  { href: "/admin/imports", label: "Import history" },
  { href: "/admin/jobs", label: "Listings" },
  { href: "/admin/subscribers", label: "Subscribers" },
];

export function AdminShell({ title, active, children, actions }: { title: string; active: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Admin" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active === t.href ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${active === t.href ? "bg-brand text-white" : "text-slate hover:bg-paper hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form action={logoutAction}>
          <button className="text-sm text-slate hover:text-ink">Sign out</button>
        </form>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.9rem] font-semibold text-ink">{title}</h1>
        {actions}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-rule bg-paper p-5 ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card>
      <div className="text-sm text-slate">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate">{hint}</div> : null}
    </Card>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    success: "bg-remote-bg text-remote", ok: "bg-remote-bg text-remote", active: "bg-remote-bg text-remote", confirmed: "bg-remote-bg text-remote", created: "bg-remote-bg text-remote", done: "bg-remote-bg text-remote",
    partial: "bg-signal-bg text-signal", duplicate: "bg-signal-bg text-signal", pending: "bg-signal-bg text-signal", expired: "bg-mist text-slate", archived: "bg-mist text-slate", skipped: "bg-mist text-slate", running: "bg-mist text-slate", updated: "bg-mist text-ink",
    failed: "bg-[#fde8e8] text-[#9b1c1c]", error: "bg-[#fde8e8] text-[#9b1c1c]", feed_error: "bg-[#fde8e8] text-[#9b1c1c]", removed: "bg-[#fde8e8] text-[#9b1c1c]", unsubscribed: "bg-mist text-slate",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone[status] ?? "bg-mist text-slate"}`}>{status.replace("_", " ")}</span>;
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-rule bg-paper">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule bg-mist text-slate">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-rule">{children}</tbody>
      </table>
    </div>
  );
}

export const inputCls = "w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

export function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function olderThanHours(d: Date | string, hours: number): boolean {
  return Date.now() - new Date(d).getTime() > hours * 3600_000;
}
