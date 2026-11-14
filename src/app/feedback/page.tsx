import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = {
  title: "Suggest a feature",
  description: "Tell us what would make your international job search easier.",
};

type Props = { searchParams: Promise<{ from?: string; kind?: string }> };

export default async function FeedbackPage({ searchParams }: Props) {
  const sp = await searchParams;
  // The page the visitor came from (a path on this site only), so a problem report says where it happened.
  const from = typeof sp.from === "string" && /^\/[^/]/.test(sp.from) ? sp.from.slice(0, 300) : null;
  return (
    <>
      <PageHeader
        title="Suggest a feature"
        crumbs={[{ href: "/", label: "Home" }, { href: "/feedback", label: "Suggest a feature" }]}
        intro="What would make your international job search easier? Tell us in a sentence or two. Problems and anything else are welcome too."
      />
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <FeedbackForm page={from} kind={sp.kind === "problem" ? "problem" : "feature"} />
        <p className="mt-6 text-sm text-slate">
          We use your message to improve the site, and your address (if you give one) only to reply. <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">Privacy policy</Link>
        </p>
      </div>
    </>
  );
}
