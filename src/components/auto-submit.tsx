"use client";

import { useEffect } from "react";

/** Submits the filter form when a select or checkbox changes (text fields still use the button/Enter). */
export function AutoSubmit({ formId, onChange: submitOnChange = true }: { formId: string; onChange?: boolean }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!submitOnChange) return;
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === "checkbox")) form.requestSubmit();
    };
    // Drop empty fields so shared URLs stay short and readable.
    const onSubmit = () => {
      for (const el of Array.from(form.elements)) {
        const field = el as HTMLInputElement | HTMLSelectElement;
        if (field.name && !field.value) field.disabled = true;
      }
      setTimeout(() => {
        for (const el of Array.from(form.elements)) (el as HTMLInputElement).disabled = false;
      }, 0);
    };
    form.addEventListener("change", onChange);
    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("change", onChange);
      form.removeEventListener("submit", onSubmit);
    };
  }, [formId, submitOnChange]);
  return null;
}
