import type { Metadata } from "next";
import { JobsBrowser } from "@/components/jobs-browser";
import { PageHeader } from "@/components/page-header";
import { parseFilters } from "@/lib/jobs";
import { countFor, landingMetadata } from "@/lib/landing";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const count = await countFor({ remote: true });
  return landingMetadata({
    title: "Remote and home-based NGO, UN and international jobs",
    description: `${count} remote and home-based vacancies and consultancies at UN agencies, international organizations and NGOs.`,
    path: "/remote-jobs",
    count,
    filters: parseFilters(await searchParams),
  });
}

export default async function RemoteJobsPage({ searchParams }: Props) {
  const filters = parseFilters(await searchParams);
  delete filters.remote;
  return (
    <>
      <PageHeader
        title="Remote and home-based jobs"
        crumbs={[{ href: "/", label: "Home" }, { href: "/remote-jobs", label: "Remote jobs" }]}
        intro="Vacancies whose posting says the work is remote, home-based or teleworking. Many are consultancies; check each posting for time-zone or nationality requirements."
      />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBrowser filters={filters} fixed={{ remote: true }} base="/remote-jobs" />
      </div>
    </>
  );
}
