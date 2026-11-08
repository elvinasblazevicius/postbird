import Link from "next/link";
import { JOB_TYPES, jobsUrl, type JobFilters } from "@/lib/jobs";
import { AutoSubmit } from "./auto-submit";

export type FacetData = {
  orgs: { slug: string; name: string; count: number }[];
  countries: { slug: string; name: string; count: number }[];
  categories: { slug: string; name: string; count: number }[];
  types?: { job_type: string; count: number }[];
};

const fieldCls =
  "w-full appearance-none rounded-lg border border-rule bg-paper px-3 py-2.5 text-[0.95rem] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]";

const chevron = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%23566476' stroke-width='1.5'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem center",
  paddingRight: "2rem",
} as const;

function Select({ name, label, value, options, all, idPrefix = "f" }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; all: string; idPrefix?: string }) {
  const id = `${idPrefix}-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <select id={id} name={name} defaultValue={value ?? ""} className={fieldCls} style={chevron}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Homepage search: keyword plus location, organization and category. */
export function HeroSearch({ facets }: { facets: FacetData }) {
  return (
    <form id="hero-search" action="/jobs" method="get" role="search" className="rounded-2xl bg-paper p-4 shadow-[0_20px_50px_-20px_rgba(11,27,63,0.55)] sm:p-5">
      <label htmlFor="hero-q" className="mb-1.5 block text-sm font-medium text-ink">Job title, skill or keyword</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="hero-q"
          name="q"
          type="search"
          placeholder="e.g. data analyst, programme officer, WASH"
          className={`${fieldCls} py-3 text-base sm:flex-1`}
          autoComplete="off"
        />
        <button type="submit" className="rounded-lg bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-accent sm:w-auto">
          Search jobs
        </button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select idPrefix="hero" name="country" label="Location" all="Any country" options={facets.countries.map((c) => ({ value: c.slug, label: `${c.name} (${c.count})` }))} />
        <Select idPrefix="hero" name="org" label="Organization" all="Any organization" options={facets.orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.count})` }))} />
        <Select idPrefix="hero" name="category" label="Category" all="Any category" options={facets.categories.filter((c) => c.count > 0).map((c) => ({ value: c.slug, label: `${c.name} (${c.count})` }))} />
        {facets.types && facets.types.length ? (
          <Select idPrefix="hero" name="type" label="Job type" all="Any type" options={JOB_TYPES.filter((t) => facets.types!.some((x) => x.job_type === t)).map((t) => ({ value: t, label: t }))} />
        ) : (
          <Select idPrefix="hero" name="closing" label="Deadline" all="Any deadline" options={[{ value: "7", label: "Closing within 7 days" }, { value: "30", label: "Closing within 30 days" }]} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-[0.95rem] text-ink">
          <input type="checkbox" name="remote" value="1" className="h-4 w-4 accent-[var(--accent)]" />
          Remote or home-based only
        </label>
        {facets.types && facets.types.length ? (
          <label className="flex items-center gap-2.5 text-[0.95rem] text-ink">
            <span>Deadline</span>
            <select name="closing" defaultValue="" className="rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-[0.95rem] text-ink">
              <option value="">Any</option>
              <option value="7">Within 7 days</option>
              <option value="30">Within 30 days</option>
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-2.5 text-[0.95rem] text-ink">
          <span>Posted</span>
          <select name="posted" defaultValue="" className="rounded-lg border border-rule bg-paper px-2.5 py-1.5 text-[0.95rem] text-ink">
            <option value="">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
          </select>
        </label>
      </div>
      <AutoSubmit formId="hero-search" onChange={false} />
    </form>
  );
}

/** Full filter panel for /jobs. Works without JavaScript; submits on change when JS is available. */
export function FilterForm({ filters, facets, action = "/jobs", hidden = {}, formId = "job-filters" }: { filters: JobFilters; facets: FacetData; action?: string; hidden?: Record<string, string>; formId?: string }) {
  const P = formId;
  return (
    <form id={formId} action={action} method="get" className="space-y-4" role="search" aria-label="Filter jobs">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div>
        <label htmlFor={`${P}-q`} className="mb-1.5 block text-sm font-medium text-ink">Keywords</label>
        <input id={`${P}-q`} name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Title, skill or organization" className={fieldCls} />
      </div>
      {!("org" in hidden) ? (
        <Select idPrefix={P} name="org" label="Organization" value={filters.org} all="Any organization" options={facets.orgs.map((o) => ({ value: o.slug, label: `${o.name} (${o.count})` }))} />
      ) : null}
      {!("country" in hidden) ? (
        <Select idPrefix={P} name="country" label="Country" value={filters.country} all="Any country" options={facets.countries.map((c) => ({ value: c.slug, label: `${c.name} (${c.count})` }))} />
      ) : null}
      {!("category" in hidden) ? (
        <Select idPrefix={P} name="category" label="Category" value={filters.category} all="Any category" options={facets.categories.filter((c) => c.count > 0 || c.slug === filters.category).map((c) => ({ value: c.slug, label: `${c.name} (${c.count})` }))} />
      ) : null}
      {facets.types && facets.types.length ? (
        <Select idPrefix={P} name="type" label="Job type" value={filters.type} all="Any type" options={JOB_TYPES.filter((t) => facets.types!.some((x) => x.job_type === t)).map((t) => ({ value: t, label: `${t} (${facets.types!.find((x) => x.job_type === t)?.count ?? 0})` }))} />
      ) : null}
      <Select idPrefix={P} name="posted" label="Posted" value={filters.posted} all="Any time" options={[{ value: "1", label: "Last 24 hours" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }]} />
      <Select idPrefix={P} name="closing" label="Application deadline" value={filters.closing} all="Any deadline" options={[{ value: "7", label: "Closing within 7 days" }, { value: "30", label: "Closing within 30 days" }]} />
      {!("remote" in hidden) ? (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-rule px-3 py-2.5 text-[0.95rem] text-ink">
          <input type="checkbox" name="remote" value="1" defaultChecked={!!filters.remote} className="h-4 w-4 accent-[var(--accent)]" />
          Remote or home-based only
        </label>
      ) : null}
      <Select idPrefix={P} name="sort" label="Sort by" value={filters.sort} all="Newest first" options={[{ value: "deadline", label: "Closing soonest" }, ...(filters.q ? [{ value: "relevance", label: "Best match" }] : [])]} />
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" className="flex-1 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-accent">Apply filters</button>
        <Link href={jobsUrl({}, action)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-accent hover:bg-mist">Clear</Link>
      </div>
      <AutoSubmit formId={formId} />
    </form>
  );
}
