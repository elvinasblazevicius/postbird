import { EmployerTypeListing, employerTypeMetadata } from "@/components/employer-type-page";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props) {
  return employerTypeMetadata("io", searchParams);
}

export default function InternationalOrganizationJobsPage({ searchParams }: Props) {
  return <EmployerTypeListing orgtype="io" searchParams={searchParams} />;
}
