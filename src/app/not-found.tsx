import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-[2.2rem] font-semibold text-ink">This page isn&apos;t here</h1>
      <p className="mt-3 text-lg text-slate">
        The vacancy may have closed and been removed, or the link is mistyped.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/jobs" className="rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-accent">Browse open jobs</Link>
        <Link href="/" className="rounded-lg border border-rule px-5 py-3 font-medium text-ink hover:bg-mist">Go to the homepage</Link>
      </div>
    </div>
  );
}
