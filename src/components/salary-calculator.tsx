"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { SearchSelect } from "@/components/search-select";
import { NET_BASE, PA_EFFECTIVE, POST_ADJUSTMENT, netRemuneration, usd } from "@/lib/un-pay";

const GRADES = ["P-1", "P-2", "P-3", "P-4", "P-5", "D-1", "D-2"];
const DEFAULT_PLACE = "USA, New York";
/** Locally recruited grades: paid on each duty station's own scale, so they open the local staff calculator. */
const LOCAL_GRADES = ["G-1", "G-2", "G-3", "G-4", "G-5", "G-6", "G-7", "NO-A", "NO-B", "NO-C", "NO-D", "NO-E"];
const LOCAL_CALCULATOR = "/guides/un-local-salaries";

/**
 * Net base salary of a grade (first to highest step) plus a duty station's post adjustment, from
 * the ICSC figures in src/lib/un-pay.ts. Allowances (dependants, rent, hardship, education) are not
 * included, and the page says so next to the result.
 *
 * The choice is kept in the address (?grade=P-3&place=Kenya), so a result can be shared as a link
 * and a vacancy can link straight to its grade.
 */
const CHANGE = "salary-calculator-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function SalaryCalculator({ placeNames = {} }: { placeNames?: Record<string, { covers: string[]; keys: string[] }> }) {
  // The address is the state: the static page renders the defaults, then the browser's choice.
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const q = new URLSearchParams(search);
  const asked = q.get("grade")?.toUpperCase();
  const grade = asked && GRADES.includes(asked) ? asked : "P-3";
  const askedPlace = q.get("place");
  const place = askedPlace && POST_ADJUSTMENT.some((x) => x.place === askedPlace) ? askedPlace : DEFAULT_PLACE;
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const placeOptions = useMemo(() => POST_ADJUSTMENT.map((p) => ({ value: p.place, label: p.place, ...placeNames[p.place] })), [placeNames]);

  function choose(nextGrade: string, nextPlace: string) {
    setCopied(false);
    const url = new URL(window.location.href);
    url.searchParams.set("grade", nextGrade);
    url.searchParams.set("place", nextPlace);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(CHANGE));
  }

  function pickGrade(next: string) {
    if (LOCAL_GRADES.includes(next)) {
      router.push(`${LOCAL_CALCULATOR}?grade=${next}#calculator`);
      return;
    }
    choose(next, place);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const pa = POST_ADJUSTMENT.find((p) => p.place === place) ?? POST_ADJUSTMENT[0];
  const [lo, hi] = NET_BASE[grade];
  const field = "mt-1 block min-h-11 w-full rounded-lg border border-rule bg-paper px-3 text-[1rem] text-ink";
  return (
    <div id="calculator" className="scroll-mt-24 rounded-xl border-2 border-brand bg-paper p-5">
      <h2 className="text-xl font-semibold">UN salary calculator</h2>
      <p className="mt-1 text-[0.95rem] text-tint-ink">Annual pay before allowances, for Professional and Director posts, in every duty station.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink">
          Grade
          <select className={field} value={grade} onChange={(e) => pickGrade(e.target.value)}>
            <optgroup label="Professional and Director">
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </optgroup>
            <optgroup label="General Service (local scales)">
              {LOCAL_GRADES.filter((g) => g.startsWith("G-")).map((g) => <option key={g} value={g}>{g}</option>)}
            </optgroup>
            <optgroup label="National Officer (local scales)">
              {LOCAL_GRADES.filter((g) => g.startsWith("NO-")).map((g) => <option key={g} value={g}>{g}</option>)}
            </optgroup>
          </select>
        </label>
        <SearchSelect label="Duty station" options={placeOptions} value={place} onChange={(v) => choose(grade, v)} placeholder="Type a country or city" keyPrefix="Covers " />
      </div>
      <p className="mt-2 text-sm text-slate">Type a country or city. A country listed once covers every duty station in it: Switzerland covers Geneva.</p>
      <p className="mt-1 text-sm text-slate">
        Looking for G or NO pay? <a href={`${LOCAL_CALCULATOR}#calculator`} className="text-accent underline">Local staff salaries</a> by duty station.
      </p>
      {/* Net pay on its own row, so a longer figure never wraps and moves what follows. */}
      <dl className="mt-5 grid gap-3 sm:grid-cols-2" aria-live="polite">
        <div className="rounded-lg bg-highlight/40 p-3 sm:col-span-2">
          <dt className="text-sm text-slate">Net pay per year</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums">
            {lo === hi ? usd(netRemuneration(lo, pa.multiplier)) : `${usd(netRemuneration(lo, pa.multiplier))} – ${usd(netRemuneration(hi, pa.multiplier))}`}
          </dd>
        </div>
        <div className="rounded-lg bg-mist p-3">
          <dt className="text-sm text-slate">Net base salary</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{lo === hi ? usd(lo) : `${usd(lo)} – ${usd(hi)}`}</dd>
        </div>
        <div className="rounded-lg bg-mist p-3">
          <dt className="text-sm text-slate">Post adjustment ({PA_EFFECTIVE})</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">+{pa.multiplier}%</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copyLink} className="min-h-11 rounded-lg border border-rule px-4 text-[0.95rem] font-medium text-ink hover:border-accent hover:text-accent">
          {copied ? "Link copied" : "Copy link to this result"}
        </button>
      </div>
      <p className="mt-3 text-sm text-slate">
        Amounts are net of staff assessment, the UN&apos;s internal levy, and run from the grade&apos;s first step to its highest. Not
        included: allowances for dependants, rent, hardship, mobility or education. Post adjustment changes monthly; this uses the{" "}
        {PA_EFFECTIVE} figures.
      </p>
    </div>
  );
}
