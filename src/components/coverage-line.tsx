import Link from "next/link";
import { coverage, joinNames } from "@/lib/coverage";

/**
 * "Covers vacancies from 120 organizations, including UNICEF, WHO, UNDP and IOM.",
 * from the open listings; nothing while fewer than 5 organizations have open vacancies.
 */
export async function CoverageLine({ className = "" }: { className?: string }) {
  const c = await coverage();
  if (!c) return null;
  return (
    <p className={`text-[0.98rem] text-slate ${className}`}>
      Covers vacancies from{" "}
      <Link href="/about#organizations" className="font-medium text-accent underline underline-offset-2">{c.count} organizations</Link>
      {c.names.length ? `, including ${joinNames(c.names)}` : ""}.
    </p>
  );
}
