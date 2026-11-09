import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PremiumInterestForm } from "@/components/token-forms";
import { categoryBySlug } from "@/config/categories";
import { countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, regionBySlug } from "@/config/regions";
import { getJob, getOrganization, parseFilters } from "@/lib/jobs";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Email alerts: early access",
  robots: { index: false, follow: true },
  alternates: { canonical: "/pricing/trial" },
};

type Props = { searchParams: Promise<{ search?: string; remind?: string }> };

/** Plain-language summary of a saved search, e.g. "Data & Analytics jobs in Africa, grade P-3". */
async function describeSearch(query: string): Promise<string | null> {
  const f = parseFilters(Object.fromEntries(new URLSearchParams(query)));
  const parts: string[] = [];
  if (f.q) parts.push(`“${f.q}”`);
  if (f.category) parts.push(`${categoryBySlug(f.category)?.name} jobs`);
  if (f.org) parts.push(`at ${(await getOrganization(f.org))?.name ?? f.org}`);
  if (f.country) parts.push(`in ${countryBySlug(f.country)?.name}`);
  if (f.region) parts.push(`in ${regionBySlug(f.region)?.name}`);
  if (f.remote) parts.push("remote / home-based");
  if (f.grade) parts.push(`grade ${GRADE_GROUPS.find((g) => g.value === f.grade)?.name ?? f.grade}`);
  if (f.type) parts.push(f.type.toLowerCase());
  if (f.lang) parts.push(`${f.lang} required`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Concept-test step: the visitor clicked an email-alert button. We say plainly
 * that alerts aren't open yet and record their interest (and what they wanted).
 */
export default async function TrialPage({ searchParams }: Props) {
  const p = siteConfig.premium;
  const sp = await searchParams;
  const search = sp.search && sp.search.length <= 400 ? sp.search : null;
  const searchLabel = search ? await describeSearch(search) : null;
  const remindId = sp.remind && /^\d{1,12}$/.test(sp.remind) ? Number(sp.remind) : null;
  const remindJob = remindId ? await getJob(remindId) : null;

  return (
    <>
      <PageHeader
        title="Email alerts launch soon"
        crumbs={[{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/pricing/trial", label: "Early access" }]}
        intro={
          <>
            {p.name} isn&apos;t open yet: we&apos;re checking whether enough people want it before we build billing. Join early access and
            you&apos;ll get one email offering the {p.trialDays}-day free trial when it opens. If we decide not to launch, we&apos;ll tell you
            and delete your address. No card, nothing charged now.
          </>
        }
      />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        {searchLabel ? (
          <p className="mb-6 rounded-xl border border-rule bg-candy-soft p-4 text-ink">
            <span className="font-semibold">Alerts for:</span> {searchLabel}
          </p>
        ) : null}
        {remindJob ? (
          <div className="mb-6 rounded-xl border border-rule bg-candy-soft p-4 text-ink">
            <p>
              <span className="font-semibold">Deadline reminder for:</span> {remindJob.title}
              {remindJob.org_name ? ` (${remindJob.org_name})` : ""}
            </p>
            <p className="mt-2 text-[0.95rem]">
              Email reminders are part of {p.name.toLowerCase()}, so we can&apos;t send this one yet. To be sure you don&apos;t miss it,{" "}
              <a href={`/api/calendar/${remindJob.id}`} rel="nofollow" className="font-semibold text-accent underline">add the deadline to your calendar</a>.
            </p>
          </div>
        ) : null}
        <PremiumInterestForm source={search ? "search-alert" : remindJob ? "deadline-reminder" : "pricing"} search={search ?? undefined} remindJobId={remindJob ? remindJob.id : undefined} />
      </div>
    </>
  );
}
