"use client";

import { useActionState } from "react";
import { metaCheckAction, type MetaCheckState } from "./actions";

/**
 * Admin → Overview: checks that the server can send events to Meta (Conversions API). Open Events
 * Manager → your pixel → Test events, copy its test code, paste it here and send: a test page view
 * shows there within a minute. Test events never count toward ads.
 */
export function MetaCheck() {
  const [state, action, pending] = useActionState<MetaCheckState, FormData>(metaCheckAction, null);
  return (
    <form action={action} className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="meta-code" className="sr-only">Test code from Events Manager</label>
        <input id="meta-code" name="code" key={state?.code ?? ""} defaultValue={state?.code ?? ""} placeholder="e.g. TEST5000" autoComplete="off" className="w-40 rounded-md border border-rule bg-paper px-3 py-2 font-mono text-ink" />
        <button disabled={pending} className="rounded-lg border border-rule px-4 py-2 font-semibold text-ink hover:bg-mist disabled:opacity-60">
          {pending ? "Sending…" : "Send test event to Meta"}
        </button>
      </div>
      {state ? <p className={`mt-3 ${state.ok ? "text-remote" : "text-[#9b1c1c]"}`}><span className="font-semibold">{state.ok ? "OK" : "Problem"}:</span> {state.detail}</p> : null}
      <p className="mt-3 text-xs text-slate">
        The test code is under Events Manager → your pixel → Test events. The site sends page views, sign-ups (Lead) and trials from the server as well as
        from the browser, so they are counted even where Meta&apos;s script is blocked.
      </p>
    </form>
  );
}
