"use client";

/**
 * The /saved page's list: the saved vacancies (see job-tools.tsx) that are still open. In a module
 * of its own, so the job rows it renders (job-card.tsx, with the country list) are only loaded on /saved.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { JobListItem } from "@/lib/jobs";
import { JobCard } from "./job-card";
import { STAGES, useSavedJobs, write, type SavedJob, type Stage } from "./job-tools";

/** "Where are you with this one?": a select under each saved vacancy, kept with the saved list on this device. */
function StagePicker({ job, list }: { job: SavedJob; list: SavedJob[] }) {
  const id = `stage-${job.id}`;
  const set = (stage: Stage) =>
    write(list.map((j) => (j.id === job.id ? { ...j, stage, stageAt: new Date().toISOString() } : j)));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2 text-sm">
      <label htmlFor={id} className="text-slate">Your progress</label>
      <select
        id={id}
        value={job.stage ?? "saved"}
        onChange={(e) => set(e.target.value as Stage)}
        className="min-h-10 rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-ink"
      >
        {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      {job.stageAt && job.stage && job.stage !== "saved" ? (
        <span className="text-slate">since {new Date(job.stageAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
      ) : null}
    </div>
  );
}

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
  const byId = new Map(list.map((j) => [j.id, j]));
  const closed = list.filter((j) => !open.some((o) => o.id === j.id));
  // Closed vacancies you applied to stay, with their progress; the others can be cleared.
  const tracked = closed.filter((j) => j.stage && j.stage !== "saved");
  const untracked = closed.filter((j) => !j.stage || j.stage === "saved");
  const counts = STAGES.filter((s) => s.value !== "saved").map((s) => ({ ...s, n: list.filter((j) => j.stage === s.value).length })).filter((s) => s.n);
  return (
    <div>
      {counts.length ? (
        <p className="mb-4 text-[0.95rem] text-ink">
          {counts.map((c, i) => <span key={c.value}>{i ? " · " : ""}{c.label}: <strong>{c.n}</strong></span>)}
        </p>
      ) : (
        <p className="mb-4 text-sm text-slate">Track your applications: set &ldquo;Your progress&rdquo; under each vacancy.</p>
      )}
      {open.length ? (
        <ul className="grid gap-4">
          {open.map((j) => (
            <li key={j.id}>
              <JobCard job={j} />
              {byId.get(j.id) ? <StagePicker job={byId.get(j.id)!} list={list} /> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-ink">None of your saved vacancies is open any more.</p>}
      {tracked.length ? (
        <section className="mt-8" aria-labelledby="tracked-closed-h">
          <h2 id="tracked-closed-h" className="text-lg font-semibold text-ink">Closed vacancies you applied to</h2>
          <ul className="mt-3 grid gap-3">
            {tracked.map((j) => (
              <li key={j.id} className="rounded-xl border border-rule p-4">
                <p className="font-semibold text-ink">{j.title}</p>
                {j.org ? <p className="text-sm text-slate">{j.org}</p> : null}
                <StagePicker job={j} list={list} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {untracked.length ? (
        <div className="mt-6 text-sm text-slate">
          <p>
            {untracked.length === 1 ? "1 saved vacancy has closed or is no longer listed." : `${untracked.length} saved vacancies have closed or are no longer listed.`}{" "}
            <button type="button" onClick={() => write(list.filter((j) => !untracked.some((u) => u.id === j.id)))} className="font-medium text-accent underline">
              Remove {untracked.length === 1 ? "it" : "them"} from this list
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}
