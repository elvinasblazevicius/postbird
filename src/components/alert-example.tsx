import { latestJobs } from "@/lib/jobs";
import { displayGrade, isLocalOnly } from "@/lib/grades";
import { formatDate, locationLabel, NOT_SPECIFIED } from "@/lib/site";

/** Used only when there are no listings to build the example from. Clearly labelled as illustrative. */
const ILLUSTRATIVE = [
  { title: "Programme Officer (Education)", org: "A UN agency", where: "Nairobi, Kenya", closes: "in 3 weeks" },
  { title: "Monitoring and Evaluation Specialist", org: "An international NGO", where: "Remote / home-based", closes: "in 2 weeks" },
  { title: "Finance Associate", org: "A development bank", where: "Manila, Philippines", closes: "in 10 days" },
];

/** "What an alert looks like": a sample alert email built from current listings. */
export async function AlertExample({ heading = "What an alert looks like" }: { heading?: string }) {
  // Posts open to international applicants first (latestJobs already ranks local-only posts last).
  const recent = await latestJobs(12).catch(() => []);
  const jobs = [...recent.filter((j) => !isLocalOnly(j)), ...recent.filter((j) => isLocalOnly(j))].slice(0, 3);
  return (
    <section aria-labelledby="sample-heading">
      <h2 id="sample-heading" className="text-xl font-semibold text-ink">{heading}</h2>
      <div className="mt-3 rounded-xl border border-rule bg-paper p-4 text-sm">
        <p className="text-xs text-slate">{jobs.length ? "Example built from current listings" : "Illustrative example"}</p>
        <p className="mt-1 font-semibold text-ink">New vacancies matching your search</p>
        <ul className="mt-2 divide-y divide-rule">
          {jobs.length
            ? jobs.map((j) => (
                <li key={j.id} className="py-2">
                  <p className="font-medium text-ink">{j.title}</p>
                  <p className="text-slate">
                    {/* Same compact line as the emails (src/lib/email-templates.ts). */}
                    {[j.org_name ?? "Organization not in our source", locationLabel(j) === NOT_SPECIFIED ? null : locationLabel(j), displayGrade(j), j.deadline ? `Closes ${formatDate(j.deadline)}` : null].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))
            : ILLUSTRATIVE.map((j) => (
                <li key={j.title} className="py-2">
                  <p className="font-medium text-ink">{j.title}</p>
                  <p className="text-slate">{j.org} · {j.where} · Closes {j.closes}</p>
                </li>
              ))}
        </ul>
      </div>
    </section>
  );
}
