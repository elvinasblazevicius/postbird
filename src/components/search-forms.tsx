import Link from "next/link";
import { FILTER_GRADE_GROUPS, gradeGroupOf } from "@/lib/grades";
import { JOB_TYPES, jobsUrl, type JobFilters } from "@/lib/jobs";
import { BILLING_LIVE } from "@/lib/billing/live";
import { AutoSubmit } from "./auto-submit";

export type FacetData = {
  orgs: { slug: string; name: string; count: number }[];
  countries: { slug: string; name: string; count: number }[];
  regions: { slug: string; name: string; count: number }[];
  categories: { slug: string; name: string; count: number }[];
  grades: { grade: string; count: number }[];
  types?: { job_type: string; count: number }[];
  langs?: { lang: string; count: number }[];
  exps?: { value: string; name: string; count: number }[];
  orgTypes?: { value: string; name: string; count: number }[];
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

type Option = { value: string; label: string };
type Group = { label: string; options: Option[] };

function Select({ name, label, value, options, groups, all, idPrefix = "f" }: { name: string; label: string; value?: string; options?: Option[]; groups?: Group[]; all: string; idPrefix?: string }) {
  const id = `${idPrefix}-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <select id={id} name={name} defaultValue={value ?? ""} className={fieldCls} style={chevron}>
        <option value="">{all}</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
        {groups?.filter((g) => g.options.length).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

const withCount = (name: string, count: number) => `${name} (${count})`;

/** One "Where" field: world regions first, then countries. Options without jobs are left out, except the one chosen. */
export function WhereSelect({ facets, filters, idPrefix, label = "Where", name = "where" }: { facets: FacetData; filters: JobFilters; idPrefix: string; label?: string; name?: string }) {
  return (
    <Select
      idPrefix={idPrefix}
      name={name}
      label={label}
      all="Anywhere"
      value={filters.region ? `region-${filters.region}` : filters.country}
      groups={[
        { label: "Regions", options: facets.regions.filter((r) => r.count > 0 || r.slug === filters.region).map((r) => ({ value: `region-${r.slug}`, label: withCount(r.name, r.count) })) },
        { label: "Countries", options: facets.countries.filter((c) => c.count > 0 || c.slug === filters.country).map((c) => ({ value: c.slug, label: withCount(c.name, c.count) })) },
      ]}
    />
  );
}

/**
 * Grade: one list, arranged by grade group. Each group starts with "All …" (the whole group,
 * e.g. P-1 to P-5), followed by the single grades in it that have open jobs ("P-3").
 * Grades outside the groups are listed last.
 */
function GradeSelect({ facets, filters, idPrefix }: { facets: FacetData; filters: JobFilters; idPrefix: string }) {
  const selected = filters.grade;
  const groups: Group[] = FILTER_GRADE_GROUPS.map((g) => {
    const grades = facets.grades.filter((x) => gradeGroupOf(x.grade) === g.value);
    const count = grades.reduce((n, x) => n + x.count, 0);
    const exact = grades.filter((x) => x.count > 0 || x.grade === selected);
    return {
      label: g.name,
      options: count > 0 || selected === g.value || exact.length
        ? [{ value: g.value, label: withCount(`${g.name.replace(/ \(.*\)$/, "")}, all grades`, count) }, ...exact.map((x) => ({ value: x.grade, label: withCount(x.grade, x.count) }))]
        : [],
    };
  });
  const other = facets.grades.filter((x) => !gradeGroupOf(x.grade) && (x.count > 0 || x.grade === selected));
  // An old link may use the "entry" group, which is not offered any more: keep it selectable while chosen.
  const legacy = selected === "entry" ? [{ value: "entry", label: "Entry level (P-1, P-2, NO-A)" }] : [];
  return (
    <Select
      idPrefix={idPrefix}
      name="grade"
      label="Grade"
      all="Any grade"
      value={selected}
      options={legacy}
      groups={[...groups, { label: "Other grades", options: other.map((x) => ({ value: x.grade, label: withCount(x.grade, x.count) })) }]}
    />
  );
}

function RemoteToggle({ checked, id }: { checked?: boolean; id: string }) {
  return (
    <div>
      <span className="mb-1.5 hidden text-sm font-medium text-ink sm:block" aria-hidden="true">&nbsp;</span>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-rule bg-paper px-3 py-2.5 text-[0.95rem] text-ink">
        <input id={id} type="checkbox" name="remote" value="1" defaultChecked={checked} className="h-4 w-4 accent-[var(--accent)]" />
        Remote only
      </label>
    </div>
  );
}

/** Secondary filters, folded away to keep the form simple. */
function MoreFilterFields({ idPrefix, filters, facets, hideOrgType = false }: { idPrefix: string; filters: JobFilters; facets: FacetData; hideOrgType?: boolean }) {
  return (
    <>
      {facets.types && (facets.types.some((x) => x.count) || filters.type) ? (
        <Select idPrefix={idPrefix} name="type" label="Contract type" value={filters.type} all="Any contract"
          options={JOB_TYPES.map((t) => ({ t, count: facets.types!.find((x) => x.job_type === t)?.count ?? 0 })).filter((x) => x.count > 0 || x.t === filters.type).map((x) => ({ value: x.t, label: withCount(x.t, x.count) }))} />
      ) : null}
      {facets.exps && (facets.exps.some((e) => e.count) || filters.exp) ? (
        <Select idPrefix={idPrefix} name="exp" label="Experience required" value={filters.exp} all="Any experience"
          options={facets.exps.filter((e) => e.count || e.value === filters.exp).map((e) => ({ value: e.value, label: withCount(e.name, e.count) }))} />
      ) : null}
      {facets.langs && (facets.langs.some((l) => l.count) || filters.lang) ? (
        <Select idPrefix={idPrefix} name="lang" label="Language in requirements" value={filters.lang} all="Any language"
          options={[...facets.langs.filter((l) => l.count || l.lang === filters.lang), ...(filters.lang && !facets.langs.some((l) => l.lang === filters.lang) ? [{ lang: filters.lang, count: 0 }] : [])].map((l) => ({ value: l.lang, label: withCount(l.lang, l.count) }))} />
      ) : null}
      {!hideOrgType && facets.orgTypes && (facets.orgTypes.some((o) => o.count) || filters.orgtype) ? (
        <Select idPrefix={idPrefix} name="orgtype" label="Type of organization" value={filters.orgtype} all="Any type"
          options={facets.orgTypes.filter((o) => o.count || o.value === filters.orgtype).map((o) => ({ value: o.value, label: withCount(o.name, o.count) }))} />
      ) : null}
      <Select idPrefix={idPrefix} name="closing" label="Deadline" value={filters.closing} all="Any deadline"
        options={[{ value: "7", label: "Closing within 7 days" }, { value: "30", label: "Closing within 30 days" }]} />
      <Select idPrefix={idPrefix} name="posted" label="Posted" value={filters.posted} all="Any time"
        options={[{ value: "1", label: "Last 24 hours" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }]} />
    </>
  );
}

function MoreToggle() {
  return (
    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-accent [&::-webkit-details-marker]:hidden">
      <span className="group-open/more:hidden">More filters</span>
      <span className="hidden group-open/more:inline">Fewer filters</span>
      <svg viewBox="0 0 12 12" className="h-3 w-3 transition-transform group-open/more:rotate-180" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
    </summary>
  );
}

const moreIsOpen = (f: JobFilters) => Boolean(f.type || f.posted || f.closing || f.lang || f.exp || f.orgtype);

/** Homepage search: What / Where / Search; every other filter under "More filters" so jobs stay close to the top. */
export function HeroSearch({ facets }: { facets: FacetData }) {
  return (
    <form id="hero-search" action="/jobs" method="get" role="search" className="rounded-2xl bg-paper p-3 shadow-[0_20px_50px_-20px_rgba(11,27,63,0.55)] sm:p-5">
      {/* On phones the labels are visually hidden (still read by screen readers) and Where sits beside the button, to keep jobs near the top. */}
      <div className="hero-main grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1.7fr_1fr_auto] sm:items-end sm:gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="hero-q" className="mb-1.5 block text-sm font-medium text-ink">What</label>
          <input id="hero-q" name="q" type="search" placeholder="Job title, skill or keyword" className={fieldCls} autoComplete="off" />
        </div>
        <WhereSelect facets={facets} filters={{}} idPrefix="hero" />
        <button type="submit" className="rounded-lg bg-brand px-5 py-2.5 text-base font-semibold text-white hover:bg-accent sm:px-7">Search<span className="hidden sm:inline"> jobs</span></button>
      </div>
      <details className="group/more mt-3">
        <MoreToggle />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select idPrefix="hero" name="org" label="Organization" all="Any organization" options={facets.orgs.map((o) => ({ value: o.slug, label: withCount(o.name, o.count) }))} />
          <Select idPrefix="hero" name="category" label="Category" all="Any category" options={facets.categories.filter((c) => c.count > 0).map((c) => ({ value: c.slug, label: withCount(c.name, c.count) }))} />
          <GradeSelect facets={facets} filters={{}} idPrefix="hero" />
          <RemoteToggle id="hero-remote" />
          <MoreFilterFields idPrefix="hero" filters={{}} facets={facets} />
        </div>
      </details>
      <AutoSubmit formId="hero-search" onChange={false} />
    </form>
  );
}

/** Filter panel for result pages. Works without JavaScript; submits on change when JS is available. */
export function FilterForm({ filters, facets, action = "/jobs", hidden = {}, formId = "job-filters" }: { filters: JobFilters; facets: FacetData; action?: string; hidden?: Record<string, string>; formId?: string }) {
  const P = formId;
  // Grades are only stated in some postings; when few have one, the grade filter moves under "More filters".
  const graded = (facets.grades ?? []).reduce((n, g) => n + g.count, 0);
  const all = facets.categories.reduce((n, c) => n + c.count, 0);
  const gradeUpFront = Boolean(filters.grade) || (all > 0 && graded / all >= 0.3);
  return (
    <form id={formId} action={action} method="get" className="space-y-4" role="search" aria-label="Filter jobs">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {filters.sort ? <input type="hidden" name="sort" value={filters.sort} /> : null}
      <div>
        <label htmlFor={`${P}-q`} className="mb-1.5 block text-sm font-medium text-ink">What</label>
        <input id={`${P}-q`} name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Title, skill or organization" className={fieldCls} />
      </div>
      {!("country" in hidden) && !("region" in hidden) ? <WhereSelect facets={facets} filters={filters} idPrefix={P} /> : null}
      {!("org" in hidden) ? (
        <Select idPrefix={P} name="org" label="Organization" value={filters.org} all="Any organization" options={facets.orgs.filter((o) => o.count > 0 || o.slug === filters.org).map((o) => ({ value: o.slug, label: withCount(o.name, o.count) }))} />
      ) : null}
      {!("category" in hidden) ? (
        <Select idPrefix={P} name="category" label="Category" value={filters.category} all="Any category" options={facets.categories.filter((c) => c.count > 0 || c.slug === filters.category).map((c) => ({ value: c.slug, label: withCount(c.name, c.count) }))} />
      ) : null}
      {gradeUpFront ? <GradeSelect facets={facets} filters={filters} idPrefix={P} /> : null}
      {!("remote" in hidden) ? (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-rule px-3 py-2.5 text-[0.95rem] text-ink">
          <input type="checkbox" name="remote" value="1" defaultChecked={!!filters.remote} className="h-4 w-4 accent-[var(--accent)]" />
          Remote / home-based only
        </label>
      ) : null}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-rule px-3 py-2.5 text-[0.95rem] text-ink">
        <input type="checkbox" name="hidelocal" value="1" defaultChecked={!!filters.hidelocal} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
        <span>
          Hide local-only posts
          <span className="block text-xs text-slate">National Officer, General Service and other posts usually open only to nationals or residents</span>
        </span>
      </label>
      <details className="group/more" open={moreIsOpen(filters)}>
        <MoreToggle />
        <div className="mt-3 space-y-4">
          {gradeUpFront ? null : <GradeSelect facets={facets} filters={filters} idPrefix={P} />}
          <MoreFilterFields idPrefix={P} filters={filters} facets={facets} hideOrgType={"orgtype" in hidden} />
        </div>
      </details>
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" className="flex-1 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-accent">Show jobs</button>
        <Link href={jobsUrl({}, action)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-accent hover:bg-mist">Clear</Link>
      </div>
      <AutoSubmit formId={formId} />
    </form>
  );
}

/**
 * "What should we watch for?": optional keyword, organization and location fields INSIDE the alert
 * sign-up form (no form of their own, so nothing typed is lost). The server turns them into the
 * saved search (searchFromSignupForm in src/lib/saved-searches.ts).
 */
export function WatchFieldset({ facets, filters }: { facets: FacetData; filters: JobFilters }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-semibold text-ink">
        What should we watch for? <span className="text-sm font-normal text-slate">(optional)</span>
      </legend>
      <p className="-mt-2 text-sm text-slate">Leave these empty to get every new vacancy.{BILLING_LIVE ? " You can add up to 5 searches later." : ""}</p>
      <div>
        <label htmlFor="watch-q" className="mb-1.5 block text-sm font-medium text-ink">Keywords</label>
        <input id="watch-q" name="watch_q" type="text" defaultValue={filters.q ?? ""} maxLength={120} placeholder="e.g. data analyst, WASH, monitoring" className={fieldCls} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select idPrefix="watch" name="watch_org" label="Organization" value={filters.org} all="Any organization"
          options={facets.orgs.filter((o) => o.count > 0 || o.slug === filters.org).map((o) => ({ value: o.slug, label: o.name }))} />
        <WhereSelect idPrefix="watch" name="watch_where" facets={facets} filters={filters} label="Location" />
      </div>
    </fieldset>
  );
}
