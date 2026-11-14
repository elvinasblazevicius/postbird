/**
 * Shown while an admin page loads (a reload, or moving between tabs): the page's shape — the tabs,
 * the title and a few cards — pulsing, with a spinner and "Loading…" for screen readers. The admin
 * pages read the database on every request, so this is often visible for a second or two.
 */
export default function AdminLoading() {
  const bar = "rounded-md bg-rule/70 motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-busy="true">
      <div className="flex flex-wrap gap-1">
        {[72, 56, 104, 72, 104, 76, 92].map((w, i) => <div key={i} className={`h-8 ${bar}`} style={{ width: w }} />)}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent motion-safe:animate-spin" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p role="status" className="text-[1.05rem] font-medium text-slate">Loading…</p>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-rule bg-paper p-5">
            <div className={`h-3.5 w-24 ${bar}`} />
            <div className={`mt-3 h-8 w-16 ${bar}`} />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-3 rounded-xl border border-rule bg-paper p-5">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-4 ${bar}`} style={{ width: `${92 - i * 9}%` }} />)}
      </div>
    </div>
  );
}
