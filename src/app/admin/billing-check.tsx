"use client";

import { useActionState } from "react";
import { billingSelfCheckAction, type SelfCheckState } from "./actions";

const initial: SelfCheckState = { checked: false, items: [] };

/** Admin → Overview: checks the Paddle API key's permissions on request (it calls Paddle). */
export function BillingSelfCheck() {
  const [state, action, pending] = useActionState(billingSelfCheckAction, initial);
  return (
    <form action={action} className="text-sm">
      <button disabled={pending} className="rounded-lg border border-rule px-4 py-2 font-semibold text-ink hover:bg-mist disabled:opacity-60">
        {pending ? "Checking…" : "Run billing self-check"}
      </button>
      {state.checked ? (
        <ul className="mt-3 space-y-1">
          {state.items.map((i) => (
            <li key={i.name} className={i.ok ? "text-remote" : "text-[#9b1c1c]"}>
              <span className="font-semibold">{i.ok ? "OK" : "Problem"}: {i.name}.</span> {i.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-slate">
        Reads the monthly price (Price: read) and one customer (Customer: read). The key also needs Transaction: write, Subscription: read and write, and
        Customer portal session: write, which can&apos;t be tested without changing anything: check them in Paddle → My account → Settings → Authentication → API keys.
      </p>
    </form>
  );
}
