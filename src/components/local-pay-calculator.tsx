"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

/** What the calculator needs of each duty station (passed from the server, so the data stays in one place). */
export type PickerStation = {
  slug: string;
  label: string;
  currency: string;
  paidIn: string;
  gs?: { effective: string; grades: Record<string, [number, number]>; note?: string };
  no?: { effective: string; grades: Record<string, [number, number]>; note?: string };
};

const CHANGE = "local-pay-calculator-change";
const DEFAULT_STATION = "nairobi";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** The grade asked for if the station has it; otherwise the nearest of the same kind (NO-E → the highest NO), then G-5. */
function fallbackGrade(offered: string[], wanted: string): string {
  if (offered.includes(wanted)) return wanted;
  const sameKind = offered.filter((g) => g.startsWith(wanted.startsWith("NO-") ? "NO-" : "G-"));
  if (sameKind.length) return wanted.startsWith("NO-") ? sameKind[sameKind.length - 1] : sameKind.includes("G-5") ? "G-5" : sameKind[0];
  return offered.includes("G-5") ? "G-5" : offered[0];
}

const amount = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Annual net pay of a General Service or National Officer grade at a duty station, from that
 * station's published scale. The choice is kept in the address (?station=nairobi&grade=G-5), so a
 * result can be shared as a link.
 */
export function LocalPayCalculator({ stations }: { stations: PickerStation[] }) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const q = new URLSearchParams(search);
  const station = stations.find((s) => s.slug === q.get("station")) ?? stations.find((s) => s.slug === DEFAULT_STATION) ?? stations[0];
  const grades = [...Object.keys(station.gs?.grades ?? {}), ...Object.keys(station.no?.grades ?? {})];
  const asked = q.get("grade")?.toUpperCase() ?? "";
  const grade = fallbackGrade(grades, asked);
  const scale = grade.startsWith("NO-") ? station.no : station.gs;
  const [lo, hi] = scale?.grades[grade] ?? [0, 0];
  const [copied, setCopied] = useState(false);

  function choose(nextStation: string, wanted: string) {
    setCopied(false);
    const st = stations.find((s) => s.slug === nextStation);
    const offered = [...Object.keys(st?.gs?.grades ?? {}), ...Object.keys(st?.no?.grades ?? {})];
    const nextGrade = fallbackGrade(offered, wanted);
    const url = new URL(window.location.href);
    url.searchParams.set("station", nextStation);
    url.searchParams.set("grade", nextGrade);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(CHANGE));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const field = "mt-1 block min-h-11 w-full rounded-lg border border-rule bg-paper px-3 text-[1rem] text-ink";
  return (
    <div id="calculator" className="scroll-mt-24 rounded-xl border-2 border-brand bg-paper p-5">
      <h2 className="text-xl font-semibold">Local staff salary calculator</h2>
      <p className="mt-1 text-[0.95rem] text-tint-ink">Annual net pay for General Service and National Officer grades, in {stations.length} duty stations.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink">
          Duty station
          <select className={field} value={station.slug} onChange={(e) => choose(e.target.value, grade)}>
            {stations.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          Grade
          <select className={field} value={grade} onChange={(e) => choose(station.slug, e.target.value)}>
            {station.gs ? (
              <optgroup label="General Service">
                {Object.keys(station.gs.grades).map((g) => <option key={g} value={g}>{g}</option>)}
              </optgroup>
            ) : null}
            {station.no ? (
              <optgroup label="National Officer">
                {Object.keys(station.no.grades).map((g) => <option key={g} value={g}>{g}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
      </div>
      {scale ? (
        <>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2" aria-live="polite">
            <div className="rounded-lg bg-highlight/40 p-3">
              <dt className="text-sm text-slate">Net pay per year, first to highest step</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums">{amount(lo, station.currency)} – {amount(hi, station.currency)}</dd>
            </div>
            <div className="rounded-lg bg-mist p-3">
              <dt className="text-sm text-slate">Per month at the first step (a year ÷ 12)</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{amount(lo / 12, station.currency)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate">
            Scale effective {dateLabel(scale.effective)}.
            {station.paidIn !== station.currency ? ` Set in ${station.currency}, paid in ${station.paidIn}.` : null}
            {scale.note ? ` This scale is ${scale.note}.` : null}{" "}
            <Link href={`/guides/un-local-salaries/${station.slug}`} className="text-accent underline">All grades for {station.label}</Link>
          </p>
        </>
      ) : null}
      <div className="mt-4">
        <button type="button" onClick={copyLink} className="min-h-11 rounded-lg border border-rule px-4 text-[0.95rem] font-medium text-ink hover:border-accent hover:text-accent">
          {copied ? "Link copied" : "Copy link to this result"}
        </button>
      </div>
      <p className="mt-3 text-sm text-slate">
        Net salary before allowances (dependants, language and others), from the duty station&apos;s published scale. The highest step
        includes long-service steps.
      </p>
    </div>
  );
}
