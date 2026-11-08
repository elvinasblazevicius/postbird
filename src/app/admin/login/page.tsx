"use client";

import { useActionState } from "react";
import { loginAction, type AdminState } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<AdminState, FormData>(loginAction, null);
  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-[1.9rem] font-semibold text-ink">Admin sign in</h1>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="w-full rounded-lg border border-rule bg-paper px-4 py-3 text-ink focus:border-accent focus:outline-none" />
        </div>
        {state && !state.ok ? <p role="alert" className="text-sm text-[#9b1c1c]">{state.message}</p> : null}
        <button disabled={pending} className="w-full rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-accent disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
