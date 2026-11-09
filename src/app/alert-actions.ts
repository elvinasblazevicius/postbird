"use server";

/**
 * The early-access sign-up on /alerts and /pricing/trial: one form with the optional "What should
 * we watch for?" fields. Their answers become the saved search the sign-up keeps, then the usual
 * sign-up runs (signupAction in src/app/actions.ts).
 */
import { signupAction, type FormState } from "@/app/actions";
import { searchFromSignupForm } from "@/lib/saved-searches";

export async function alertSignupAction(prev: FormState, form: FormData): Promise<FormState> {
  const search = searchFromSignupForm(form);
  if (search) form.set("search", search);
  else form.delete("search");
  return signupAction(prev, form);
}
