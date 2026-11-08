"use client";

import { useActionState } from "react";
import { addFeedAction, type AdminState } from "../actions";
import { inputCls } from "../ui";

export function AddFeedForm() {
  const [state, action, pending] = useActionState<AdminState, FormData>(addFeedAction, null);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-[1fr_2fr]">
      <input name="name" placeholder="Name, e.g. UN jobs folder" className={inputCls} aria-label="Feed name" />
      <input name="url" required placeholder="https://www.inoreader.com/stream/user/…/tag/…" className={inputCls} aria-label="Feed address" />
      <input name="default_organization" placeholder="Organization (only if the feed is for one employer)" className={inputCls} aria-label="Organization for every item" />
      <div className="flex gap-3">
        <select name="content_policy" defaultValue="none" className={inputCls} aria-label="What may be republished">
          <option value="none">Metadata and link only (safest)</option>
          <option value="excerpt">Plus a short summary</option>
          <option value="full">Plus the full description</option>
        </select>
        <button disabled={pending} className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-accent disabled:opacity-60">
          {pending ? "Checking…" : "Add feed"}
        </button>
      </div>
      {state ? <p role="status" className={`md:col-span-2 text-sm ${state.ok ? "text-remote" : "text-[#9b1c1c]"}`}>{state.message}</p> : null}
    </form>
  );
}
