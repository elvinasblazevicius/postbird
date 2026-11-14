import type { Metadata } from "next";
import { SavedJobs } from "@/components/saved-jobs";
import { PageHeader } from "@/components/page-header";

/**
 * Built at deploy without the database, so the header and footer list only the employer types that
 * always have vacancies; rendered again at most hourly after that, with the real counts (employerNav
 * in src/components/site-header.tsx).
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Saved jobs",
  description: "Vacancies you saved on this device.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/saved" },
};

export default function SavedPage() {
  return (
    <>
      <PageHeader width="max-w-4xl"
        title="Saved jobs and applications"
        crumbs={[{ href: "/", label: "Home" }, { href: "/saved", label: "Saved jobs" }]}
        intro="Vacancies you saved, and where you are with each application. Kept only in this browser on this device."
      />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <SavedJobs />
      </div>
    </>
  );
}
