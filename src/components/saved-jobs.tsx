"use client";

/**
 * The /saved page's list: the saved vacancies (see job-tools.tsx) that are still open. In a module
 * of its own, so the job rows it renders (job-card.tsx, with the country list) are only loaded on /saved.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { JobListItem } from "@/lib/jobs";
import { JobList } from "./job-card";
import { useSavedJobs, write } from "./job-tools";

/** The /saved page: saved vacancies that are still open, newest saved first. */
export function SavedJobs() {
  const list = useSavedJobs();
  const ids = useMemo(() => (list ?? []).map((j) => j.id), [list]);
  const key = ids.join(",");
  const [result, setResult] = useState<{ key: string; jobs: JobListItem[] } | { key: string; error: true } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/saved?ids=${key}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { jobs: JobListItem[] }) => !cancelled && setResult({ key, jobs: d.jobs }))
      .catch(() => !cancelled && setResult({ key, error: true }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (list === null) return <p className="text-slate">Loading your saved jobs…</p>;
  if (!list.length) {
    return (
      <div className="rounded-xl border border-dashed border-rule p-6">
        <p className="text-ink">You haven&apos;t saved any vacancies yet.</p>
        <p className="mt-1 text-slate">Use the bookmark beside a vacancy, or Save on its page, to keep it here.</p>
        <p className="mt-4"><Link href="/jobs" className="font-medium text-accent underline">Browse open vacancies</Link></p>
      </div>
    );
  }
  if (!result || result.key !== key) return <p className="text-slate">Checking which saved vacancies are still open…</p>;
  if ("error" in result) return <p role="alert" className="text-ink">We couldn&apos;t check your saved vacancies just now. Please reload the page.</p>;
  const order = new Map(ids.map((id, i) => [id, i]));
  const open = [...result.jobs].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const closed = list.filter((j) => !open.some((o) => o.id === j.id));
  return (
    <div>
      {open.length ? <JobList jobs={open} /> : <p className="text-ink">None of your saved vacancies is open any more.</p>}
      {closed.length ? (
        <div className="mt-6 text-sm text-slate">
          <p>
            {closed.length === 1 ? "1 saved vacancy has closed or is no longer listed." : `${closed.length} saved vacancies have closed or are no longer listed.`}{" "}
            <button type="button" onClick={() => write(list.filter((j) => open.some((o) => o.id === j.id)))} className="font-medium text-accent underline">
              Remove {closed.length === 1 ? "it" : "them"} from this list
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}
