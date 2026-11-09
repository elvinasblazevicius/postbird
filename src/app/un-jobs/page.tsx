import { EmployerTypeListing, employerTypeMetadata } from "@/components/employer-type-page";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props) {
  return employerTypeMetadata("un", searchParams);
}

export default function UnJobsPage({ searchParams }: Props) {
  return <EmployerTypeListing orgtype="un" searchParams={searchParams} />;
}
