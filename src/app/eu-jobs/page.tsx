import { EmployerTypeListing, employerTypeMetadata } from "@/components/employer-type-page";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props) {
  return employerTypeMetadata("eu", searchParams);
}

export default function EuJobsPage({ searchParams }: Props) {
  return <EmployerTypeListing orgtype="eu" searchParams={searchParams} />;
}
