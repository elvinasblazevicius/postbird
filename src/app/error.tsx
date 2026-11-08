"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-[2.2rem] font-semibold text-ink">This page couldn&apos;t load</h1>
      <p className="mt-3 text-lg text-slate">Something went wrong while loading vacancies. Try again in a moment.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button onClick={() => reset()} className="rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-accent">Try again</button>
        <Link href="/" className="rounded-lg border border-rule px-5 py-3 font-medium text-ink hover:bg-mist">Go to the homepage</Link>
      </div>
    </div>
  );
}
