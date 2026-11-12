"use client";

/**
 * Small tools for job seekers: share a vacancy, and a shortlist of saved vacancies kept only in
 * this browser (localStorage, never sent to us except the vacancy numbers /saved asks about).
 * Loaded on every page (the header's saved count), so it stays small: the /saved list, which
 * renders job rows, is in saved-jobs.tsx.
 */
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

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
export function write(list: SavedJob[]): boolean {
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
 * The header's link to /saved with how many vacancies are saved in this browser. Nothing at all
 * while none are saved, before the browser has been read, or where storage is blocked.
 */
export function SavedCount({ className = "px-2" }: { className?: string }) {
  const list = useSavedJobs();
  const n = list?.length ?? 0;
  if (!n) return null;
  return (
    <Link
      href="/saved"
      aria-label={`Saved jobs: ${n}`}
      title="Saved jobs"
      className={`inline-flex items-center gap-1 rounded-lg py-2 text-sm font-semibold text-accent hover:bg-tint ${className}`}
    >
      <Bookmark filled />
      <span className="tabular-nums">{n}</span>
    </Link>
  );
}

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
        // A 44×44px tap target (the ::before layer, centred on the button) without changing the icon or the row's layout.
        className={`relative z-10 rounded-md p-1.5 transition-[color,background-color,transform] duration-150 before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:bg-tint active:scale-90 ${saved ? "text-accent motion-safe:animate-[save-pop_220ms_ease-out]" : "text-slate hover:text-accent"}`}
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-accent transition-[background-color,transform] duration-150 hover:bg-tint active:scale-[0.97]"
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
