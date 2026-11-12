"use client";

import { useEffect, useTransition } from "react";
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

  useEffect(() => {
    const root = document.documentElement;
    if (pending) root.setAttribute("data-filtering", "");
    else root.removeAttribute("data-filtering");
    return () => root.removeAttribute("data-filtering");
  }, [pending]);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    if (restore?.formId === formId) {
      const { field, open } = restore;
      restore = null;
      for (const d of Array.from(form.querySelectorAll<HTMLDetailsElement>("details[data-fold]"))) if (open.includes(d.dataset.fold!)) d.open = true;
      const match = field && (Array.from(form.elements).find((el) => {
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
        changed = f.name ? { name: f.name, value: f.value } : undefined;
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
      for (const [k, v] of new FormData(form)) if (typeof v === "string" && v.trim()) params.append(k, v);
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
