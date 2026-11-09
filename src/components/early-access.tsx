"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { planChoiceAction } from "@/app/actions";
import siteConfig from "@site-config";

/**
 * Shown after someone joins early access: what happens next, a one-click
 * "which plan would you choose?" question, and a way back to the jobs.
 */
export function EarlyAccessDone({ message, source, tone = "light" }: { message: string; source: string; tone?: "light" | "dark" }) {
  const [answered, setAnswered] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dark = tone === "dark";
  const plans = siteConfig.premium.plans;
  const options: { value: string; label: string }[] = [
    { value: "monthly", label: plans[0] ? `${plans[0].price} a month` : "Monthly" },
    { value: "three_months", label: plans[1] ? `${plans[1].price} for ${plans[1].per}` : "3 months" },
    { value: "would_not_pay", label: "I wouldn't pay" },
  ];
  const choose = (value: string) =>
    start(async () => {
      await planChoiceAction(value, source).catch(() => false);
      setAnswered(value);
    });
  const box = dark ? "bg-white/10 text-white" : "bg-remote-bg text-ink";
  const btn = dark
    ? "border-white/40 text-white hover:bg-white/15"
    : "border-rule bg-paper text-ink hover:border-accent hover:text-accent";
  return (
    <div role="status" className={`rounded-xl p-5 text-[1.02rem] leading-relaxed ${box}`}>
      <p>{message}</p>
      <div className="mt-4">
        {answered ? (
          <p className="font-medium">Thanks, that helps us decide.</p>
        ) : (
          <>
            <p className="font-medium">One quick question: if alerts opened today, which would you choose?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={pending}
                  onClick={() => choose(o.value)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${btn}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="mt-4">
        <Link href="/jobs" className={`font-semibold underline ${dark ? "text-white" : "text-accent"}`}>
          Keep browsing jobs
        </Link>
      </p>
    </div>
  );
}
