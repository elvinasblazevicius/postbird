"use client";

import { useEffect, useRef, useState } from "react";

/** "A, B or C" (as orList in src/lib/filter-labels.ts). */
const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** The names chosen in one watch field: the chips of the type-ahead picker, or the chosen options of the plain selects. */
function chosenNames(form: HTMLFormElement, field: string): string[] {
  const combo = form.querySelector(`[data-combobox][data-field="${field}"]`);
  if (combo) return Array.from(combo.querySelectorAll(`ul[aria-label^="Chosen"] > li > span:first-child`)).map((e) => e.textContent?.trim() ?? "").filter(Boolean);
  return Array.from(form.querySelectorAll<HTMLSelectElement>(`select[name="${field}"]`))
    .filter((s) => s.value)
    .map((s) => s.selectedOptions[0]?.textContent?.replace(/\s*\(\d[\d,]*\)\s*$/, "").trim() ?? "")
    .filter(Boolean);
}

/**
 * What the free weekly email will follow ("“monitoring”, in Kenya"), kept up to date while the
 * visitor edits the keywords, organization or location in the same form. `initial` is the server's
 * wording for the search the page was opened with; `kept` the parts of it the fields don't show
 * (a grade, a category), which the sign-up keeps. Once edited, the "Your alerts will follow the
 * search you just made" note above the cards ([data-carried-search]) no longer applies and is hidden.
 */
export function FollowsLabel({ initial, kept }: { initial: string; kept?: string | null }) {
  const ref = useRef<HTMLElement>(null);
  const [label, setLabel] = useState(initial);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () =>
      setTimeout(() => {
        const q = (form.querySelector<HTMLInputElement>('[name="watch_q"]')?.value ?? "").trim();
        const orgs = chosenNames(form, "watch_org");
        const places = chosenNames(form, "watch_where");
        const parts = [q ? `“${q}”` : "", orgs.length ? `at ${orList(orgs)}` : "", places.length ? `in ${orList(places)}` : "", kept ?? ""].filter(Boolean);
        const next = parts.length ? parts.join(", ") : "all new vacancies";
        setLabel(next);
        document.querySelectorAll<HTMLElement>("[data-carried-search]").forEach((e) => (e.hidden = true));
        // The rest of the page that names the search: the Daily alerts card's line, and the example email's note.
        document.querySelectorAll<HTMLElement>("[data-follows-copy]").forEach((e) => (e.textContent = next));
        document.querySelectorAll<HTMLElement>("[data-example-stale]").forEach((e) => (e.hidden = false));
      }, 0);
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [kept]);
  return <strong ref={ref} className="font-semibold" aria-live="polite">{label}</strong>;
}
