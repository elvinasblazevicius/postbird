import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import siteConfig from "@site-config";
import { StoryForm } from "./story-form";

export const metadata: Metadata = {
  title: "Share your experience",
  description: `Tell us how ${siteConfig.name} has helped your international job search.`,
};

type Props = { searchParams: Promise<{ from?: string }> };

export default async function SharePage({ searchParams }: Props) {
  const sp = await searchParams;
  const from = typeof sp.from === "string" && /^\/[^/]/.test(sp.from) ? sp.from.slice(0, 300) : null;
  return (
    <>
      <PageHeader
        title="Share your experience"
        crumbs={[{ href: "/", label: "Home" }, { href: "/share", label: "Share your experience" }]}
        intro={`Did an alert help you find or apply for a vacancy? Tell us in a few sentences: it helps us improve ${siteConfig.name}, and with your permission it helps other job seekers decide.`}
      />
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <StoryForm page={from} />
        <p className="mt-6 text-sm text-slate">
          Only words people send us here, with their permission, are ever shown on the site, and only after we have read them. <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">Privacy policy</Link>
        </p>
      </div>
    </>
  );
}
