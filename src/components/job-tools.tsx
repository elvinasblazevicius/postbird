"use client";

/**
 * Small tools for job seekers: share a vacancy, and a shortlist of saved vacancies kept only in
 * this browser (localStorage, never sent to us except the vacancy numbers /saved asks about).
 */
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { JobListItem } from "@/lib/jobs";
import { JobList } from "./job-card";

const KEY = "pb_saved_jobs";
const CHANGED = "postbird:saved-changed";
const MAX_SAVED = 100;

export type SavedJob = { id: number; path: string; title: string; org: string | null; savedAt: string };

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): SavedJob[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && Number.isInteger(x.id) && typeof x.path === "string" && typeof x.title === "string") : [];
  } catch {
    return [];
  }
}

/** Saves the list; false when the browser doesn't allow storage (private mode, blocked site data). */
function write(list: SavedJob[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGED, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGED, cb);
  };
}

/** The saved vacancies, or null before the browser has been read (server render). */
export function useSavedJobs(): SavedJob[] | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => (raw === null ? null : parse(raw)), [raw]);
}

const Bookmark = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
    <path d="M4 2.5h8v11l-4-2.8-4 2.8z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

/**
 * Save / Saved toggle. `compact`: icon only (job rows), with the job title in its accessible name.
 * Sits above the row's full-size link (relative z-10) so it can be clicked on its own.
 */
export function SaveButton({ job, compact = false }: { job: Omit<SavedJob, "savedAt">; compact?: boolean }) {
  const list = useSavedJobs();
  const [blocked, setBlocked] = useState(false);
  const saved = Boolean(list?.some((j) => j.id === job.id));
  const toggle = () => {
    const current = parse(readRaw());
    const next = saved ? current.filter((j) => j.id !== job.id) : [{ ...job, savedAt: new Date().toISOString() }, ...current.filter((j) => j.id !== job.id)];
    setBlocked(!write(next));
  };
  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`}
        title={blocked ? "This browser doesn't allow saving" : saved ? "Saved" : "Save"}
        className={`relative z-10 rounded-md p-1.5 hover:bg-tint ${saved ? "text-accent" : "text-slate hover:text-accent"}`}
      >
        <Bookmark filled={saved} />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-accent hover:bg-tint"
      >
        <Bookmark filled={saved} />
        {saved ? "Saved" : "Save"}
      </button>
      {blocked ? <span role="status" className="text-xs text-slate">This browser doesn&apos;t allow saving.</span> : null}
    </span>
  );
}

/** Share: the phone's share sheet where there is one, otherwise copy the link. */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);
  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch {
      setNote(url);
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <button type="button" onClick={share} className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-accent hover:bg-tint">
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true"><path d="M8 10V2.5M5 5.5l3-3 3 3M3.5 8.5v5h9v-5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        Share
      </button>
      {note ? <span role="status" className="min-w-0 break-all text-xs text-slate">{note}</span> : null}
    </span>
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
