"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * What to put back when the form is drawn again for the new address: focus on the box just ticked,
 * and the folded sections (data-fold) that were open.
 */
let restore: { formId: string; field?: { name: string; value: string }; open: string[] } | null = null;

/**
 * Applies the filter form without a full page load: the new results are fetched in the background
 * and swapped in, the page keeps its scroll position (unless `keepScroll` is off) and the results
 * dim while they load. Submits on a select or checkbox change, or when a field marked
 * data-autosubmit (the type-ahead pickers, src/components/multi-combobox.tsx) says its choice
 * changed; text fields still use the button/Enter. Without JavaScript the form is a plain GET form.
 * Empty fields are left out so shared URLs stay short and readable.
 */
export function AutoSubmit({ formId, onChange: submitOnChange = true, keepScroll = true }: { formId: string; onChange?: boolean; keepScroll?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const wasPending = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    if (pending) root.setAttribute("data-filtering", "");
    else root.removeAttribute("data-filtering");
    // New results in: when their heading (the count) is scrolled out of view above, bring it back,
    // so the change shows; the filters stay where they are (the sidebar is sticky).
    if (wasPending.current && !pending && keepScroll) {
      const h = document.getElementById("results-heading");
      if (h && h.getBoundingClientRect().top < 0) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY - 110, behavior: reduce ? "auto" : "smooth" });
      }
    }
    wasPending.current = pending;
    return () => root.removeAttribute("data-filtering");
  }, [pending, keepScroll]);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    if (restore?.formId === formId) {
      const { field, open } = restore;
      restore = null;
      for (const d of Array.from(form.querySelectorAll<HTMLDetailsElement>("details[data-fold]"))) if (open.includes(d.dataset.fold!)) d.open = true;
      const match = field && (field.name.startsWith("combobox:")
        ? form.querySelector<HTMLElement>(`input[data-combobox-input="${field.name.slice(9)}"]`) ?? undefined
        : Array.from(form.elements).find((el) => {
          const f = el as HTMLInputElement;
          return f.name === field.name && f.type !== "hidden" && (f.type !== "checkbox" || f.value === field.value);
        }) as HTMLElement | undefined);
      match?.focus({ preventScroll: true });
    }
    let changed: { name: string; value: string } | undefined;

    const onChange = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!submitOnChange) return;
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === "checkbox") || t.dataset?.autosubmit === "true") {
        const f = t as HTMLInputElement;
        // A place or organization picker has no name of its own: remember which one it is.
        changed = f.name ? { name: f.name, value: f.value } : t.dataset.field ? { name: `combobox:${t.dataset.field}`, value: "" } : undefined;
        form.requestSubmit();
      }
    };
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault();
      restore = {
        formId,
        field: changed,
        open: Array.from(form.querySelectorAll<HTMLDetailsElement>("details[data-fold]")).filter((d) => d.open).map((d) => d.dataset.fold!),
      };
      changed = undefined;
      const params = new URLSearchParams();
      // The same choice is never sent twice (a picker's typed text can add a field the form already has).
      const seen = new Set<string>();
      for (const [k, v] of new FormData(form)) {
        if (typeof v !== "string" || !v.trim() || seen.has(`${k}=${v}`)) continue;
        seen.add(`${k}=${v}`);
        params.append(k, v);
      }
      const qs = params.toString();
      const action = new URL(form.action, location.href);
      // A panel that opened to show the form (on phones) closes when the results are shown.
      if (!keepScroll) form.closest("details")?.removeAttribute("open");
      startTransition(() => router.push(`${action.pathname}${qs ? `?${qs}` : ""}`, { scroll: !keepScroll }));
    };
    form.addEventListener("change", onChange);
    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("change", onChange);
      form.removeEventListener("submit", onSubmit);
    };
  }, [formId, submitOnChange, keepScroll, router]);
  return null;
}
