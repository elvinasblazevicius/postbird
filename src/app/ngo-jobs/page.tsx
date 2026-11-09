import { EmployerTypeListing, employerTypeMetadata } from "@/components/employer-type-page";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props) {
  return employerTypeMetadata("ngo", searchParams);
}

export default function NgoJobsPage({ searchParams }: Props) {
  return <EmployerTypeListing orgtype="ngo" searchParams={searchParams} />;
}
