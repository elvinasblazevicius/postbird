import Link from "next/link";
import { andList, STATED_DETAIL } from "@/lib/filter-labels";
import { FILTER_GRADE_GROUPS, gradeGroupOf, gradeText } from "@/lib/grades";
import { derivedFilters, JOB_TYPES, jobsUrl, type JobFilters } from "@/lib/jobs";
import { BILLING_LIVE } from "@/lib/billing/live";
import { AutoSubmit } from "./auto-submit";
import { MultiCombobox, type ComboGroup } from "./multi-combobox";

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

/** The chosen places as "where" values: "region-africa", "kenya". */
const chosenPlaces = (f: JobFilters) => [...(f.region ?? []).map((r) => `region-${r}`), ...(f.country ?? [])];

/** Regions first, then countries, with their counts (the type-ahead picker). Options without jobs are left out, except the ones chosen. */
function placeChoices(facets: FacetData, filters: JobFilters): ComboGroup[] {
  return [
    { label: "Regions", options: facets.regions.filter((r) => r.count > 0 || filters.region?.includes(r.slug)).map((r) => ({ value: `region-${r.slug}`, name: r.name, count: r.count })) },
    { label: "Countries", options: facets.countries.filter((c) => c.count > 0 || filters.country?.includes(c.slug)).map((c) => ({ value: c.slug, name: c.name, count: c.count })) },
  ];
}

/** The same as native select groups: "Kenya (12)". */
function placeGroups(facets: FacetData, filters: JobFilters): Group[] {
  return placeChoices(facets, filters).map((g) => ({ label: g.label, options: g.options.map((o) => ({ value: o.value, label: withCount(o.name, o.count ?? 0) })) }));
}

/** One "Where" field (the homepage search): world regions first, then countries. */
export function WhereSelect({ facets, filters, idPrefix, label = "Where", name = "where" }: { facets: FacetData; filters: JobFilters; idPrefix: string; label?: string; name?: string }) {
  return <Select idPrefix={idPrefix} name={name} label={label} all="Anywhere" value={chosenPlaces(filters)[0]} groups={placeGroups(facets, filters)} />;
}

/** Most places one search can hold. */
const MAX_PLACES = 5;
/** Most organizations one search can hold. */
const MAX_ORGS = 5;

/**
 * A field that may hold several values (a listing matching any of them matches): one select per
 * chosen value (or one empty select), and under it an "Add another …" link-style button that opens
 * one more select. Works without JavaScript: the button is a native disclosure (details/summary),
 * each select is a repeated field of the same name, and an empty one is ignored.
 */
function RepeatSelect({ name, label, idPrefix, chosen, groups, anyLabel, chooseLabel, addLabel, addHint, removeLabel, itemNoun, max }: {
  name: string; label: string; idPrefix: string; chosen: string[]; groups: Group[];
  anyLabel: string; chooseLabel: string; addLabel: string; addHint: string; removeLabel: string; itemNoun: string; max: number;
}) {
  const options = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {groups.length === 1 && !groups[0].label
        ? groups[0].options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
        : groups.filter((g) => g.options.length).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
    </>
  );
  const values = chosen.length ? chosen : [""];
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-ink">{label}</legend>
      <div className="space-y-2">
        {values.map((v, i) => (
          <select
            key={v || "none"}
            id={`${idPrefix}-${name}-${i}`}
            name={name}
            defaultValue={v}
            aria-label={values.length > 1 ? `${label}, ${itemNoun} ${i + 1} of ${values.length}` : label}
            className={fieldCls}
            style={chevron}
          >
            {options(values.length > 1 ? removeLabel : anyLabel)}
          </select>
        ))}
      </div>
      {chosen.length < max ? (
        <details className="group/add mt-1.5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1 text-sm font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
            <svg viewBox="0 0 12 12" className="h-3 w-3 transition-transform group-open/add:rotate-45" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            {addLabel}
          </summary>
          <div className="mt-1.5">
            <label htmlFor={`${idPrefix}-${name}-add`} className="mb-1 block text-xs text-slate">{addHint}</label>
            <select id={`${idPrefix}-${name}-add`} name={name} defaultValue="" className={fieldCls} style={chevron}>
              {options(chooseLabel)}
            </select>
          </div>
        </details>
      ) : null}
    </fieldset>
  );
}

/**
 * "Where" for result pages and alerts, with room for several places (a listing in any of them
 * matches): a type-ahead picker with chips (regions listed above countries); without JavaScript,
 * one select per chosen place and "Add another place" under them.
 */
export function WhereFields({ facets, filters, idPrefix, label = "Where", name = "where" }: { facets: FacetData; filters: JobFilters; idPrefix: string; label?: string; name?: string }) {
  const chosen = chosenPlaces(filters);
  return (
    <MultiCombobox name={name} label={label} idPrefix={idPrefix} groups={placeChoices(facets, filters)} chosen={chosen} max={MAX_PLACES}
      placeholder="Anywhere: type a place" itemNoun="place" itemsNoun="places" anyHint="Jobs in any of the places you choose">
      <RepeatSelect name={name} label={label} idPrefix={idPrefix} chosen={chosen} groups={placeGroups(facets, filters)} max={MAX_PLACES}
        anyLabel="Anywhere" chooseLabel="Choose a place" addLabel="Add another place" addHint="Jobs in any of the places you choose" removeLabel="Remove this place" itemNoun="place" />
    </MultiCombobox>
  );
}

/**
 * Organization for result pages and alerts, with room for several (a listing at any of them
 * matches), like WhereFields. Organizations without open jobs are left out, except the ones chosen.
 */
export function OrgFields({ facets, filters, idPrefix, name = "org", counts = true }: { facets: FacetData; filters: JobFilters; idPrefix: string; name?: string; counts?: boolean }) {
  const chosen = filters.org ?? [];
  const orgs = facets.orgs.filter((o) => o.count > 0 || chosen.includes(o.slug));
  const options = orgs.map((o) => ({ value: o.slug, label: counts ? withCount(o.name, o.count) : o.name }));
  return (
    <MultiCombobox name={name} label="Organization" idPrefix={idPrefix} groups={[{ label: "", options: orgs.map((o) => ({ value: o.slug, name: o.name, count: counts ? o.count : undefined })) }]}
      chosen={chosen} max={MAX_ORGS} placeholder="Any organization: type a name" itemNoun="organization" itemsNoun="organizations" anyHint="Jobs at any of the organizations you choose">
      <RepeatSelect name={name} label="Organization" idPrefix={idPrefix} chosen={chosen} groups={[{ label: "", options }]} max={MAX_ORGS}
        anyLabel="Any organization" chooseLabel="Choose an organization" addLabel="Add another organization" addHint="Jobs at any of the organizations you choose" removeLabel="Remove this organization" itemNoun="organization" />
    </MultiCombobox>
  );
}

/** "National Officer, any level" for the group "National Officer (NO-A to NO-E)". */
export function anyLevelLabel(groupName: string): string {
  return `${groupName.replace(/ \(.*\)$/, "")}, any level`;
}

/**
 * The count for a whole grade group: its single grades plus listings counted under the group itself
 * (no grade parsed, the title gives the group: "NO", "P", "G"); and the single grades to list.
 */
export function gradeGroupCounts(facets: { grades: { grade: string; count: number }[] }, group: string, isSelected: (grade: string) => boolean) {
  const grades = facets.grades.filter((x) => gradeGroupOf(x.grade) === group);
  const count = grades.reduce((n, x) => n + x.count, 0);
  const exact = grades.filter((x) => x.grade !== group && (x.count > 0 || isSelected(x.grade)));
  return { count, exact };
}

/**
 * Grade: one list, arranged by grade group. Each group starts with "{Group}, any level" (the whole
 * group: its grades, e.g. P-1 to P-5, and listings whose title gives only the group, such as
 * "National Officer" or IOM's "(P)"), followed by the single grades in it that have open jobs
 * ("P-3"). Grades outside the groups are listed last.
 */
function GradeSelect({ facets, filters, idPrefix }: { facets: FacetData; filters: JobFilters; idPrefix: string }) {
  const selected = filters.grade?.[0];
  const groups: Group[] = FILTER_GRADE_GROUPS.map((g) => {
    const { count, exact } = gradeGroupCounts(facets, g.value, (grade) => grade === selected);
    return {
      label: g.name,
      options: count > 0 || selected === g.value || exact.length
        ? [{ value: g.value, label: withCount(anyLevelLabel(g.name), count) }, ...exact.map((x) => ({ value: x.grade, label: withCount(gradeText(x.grade), x.count) }))]
        : [],
    };
  });
  const other = facets.grades.filter((x) => !gradeGroupOf(x.grade) && x.grade !== "entry" && (x.count > 0 || x.grade === selected));
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
      groups={[...groups, { label: "Other grades", options: other.map((x) => ({ value: x.grade, label: withCount(gradeText(x.grade), x.count) })) }]}
    />
  );
}

/**
 * Grade as checkboxes (result pages), compact: one "{Group}, any level" box per grade group with
 * open jobs, and the group's single grades ("P-3") folded under it (open while one is ticked).
 * Several can be ticked; a listing with any of them matches. Grades outside the groups come last.
 */
function GradeChecks({ facets, filters }: { facets: FacetData; filters: JobFilters }) {
  const selected = new Set(filters.grade ?? []);
  const groups = FILTER_GRADE_GROUPS.map((g) => {
    const { count, exact } = gradeGroupCounts(facets, g.value, (grade) => selected.has(grade));
    return { key: g.value, name: g.name.replace(/ \(.*\)$/, ""), any: anyLevelLabel(g.name), count, exact, show: count > 0 || selected.has(g.value) || exact.length > 0 };
  }).filter((g) => g.show);
  const other = facets.grades.filter((x) => !gradeGroupOf(x.grade) && x.grade !== "entry" && (x.count > 0 || selected.has(x.grade)));
  // An old link may use the "entry" group, which is not offered any more: keep it while chosen.
  const legacy = selected.has("entry");
  if (!groups.length && !other.length && !legacy) return null;
  const box = (value: string, label: React.ReactNode, count: number | null) => (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-[0.95rem] text-ink">
      <input type="checkbox" name="grade" value={value} defaultChecked={selected.has(value)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
      <span>{label}{count !== null ? <> <span className="text-slate">({count})</span></> : null}</span>
    </label>
  );
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-ink">Grade</legend>
      <ul>
        {legacy ? <li>{box("entry", "Entry level (P-1, P-2, NO-A)", null)}</li> : null}
        {groups.map((g) => (
          <li key={g.key}>
            {box(g.key, g.any, g.count)}
            {g.exact.length ? (
              <details className="group/levels ml-6" open={g.exact.some((x) => selected.has(x.grade))}>
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-accent [&::-webkit-details-marker]:hidden">
                  {g.name} levels
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 transition-transform group-open/levels:rotate-180" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                </summary>
                <ul className="grid grid-cols-2 gap-x-3">
                  {g.exact.map((x) => <li key={x.grade}>{box(x.grade, gradeText(x.grade), x.count)}</li>)}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
        {other.map((x) => <li key={x.grade}>{box(x.grade, gradeText(x.grade), x.count)}</li>)}
      </ul>
    </fieldset>
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

/**
 * "Also show vacancies that don't state a grade": with a filter read from the posting's text in
 * use, listings that don't state that detail are left out unless this is ticked (`unstated`).
 */
function UnstatedToggle({ filters, idPrefix }: { filters: JobFilters; idPrefix: string }) {
  const derived = derivedFilters(filters);
  if (!derived.length) return null;
  return (
    <label htmlFor={`${idPrefix}-unstated`} className="flex cursor-pointer items-start gap-2.5 text-[0.95rem] text-ink">
      <input id={`${idPrefix}-unstated`} type="checkbox" name="unstated" value="1" defaultChecked={!!filters.unstated} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />
      <span>Also show vacancies that don&apos;t state {andList(derived.map((k) => STATED_DETAIL[k]))}</span>
    </label>
  );
}

/** Homepage search: What / Where / Search; every other filter under "More filters" so jobs stay close to the top. */
export function HeroSearch({ facets }: { facets: FacetData }) {
  return (
    <form id="hero-search" action="/jobs" method="get" role="search">
      {/* No card around it: the fields sit on the hero itself (white labels and focus ring: #hero-search in globals.css). */}
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

/**
 * Filter panel for result pages. Works without JavaScript. With `submitOnChange` (the desktop
 * panel) a changed select or checkbox applies at once; on phones people set several filters and
 * then tap "Show jobs", so the panel there waits for the button. Without `keyword` the panel has
 * no keyword field: on phones the keyword box above the results belongs to this form instead
 * (its `form` attribute), so there is one keyword field and every submit carries it.
 */
export function FilterForm({ filters, facets, action = "/jobs", hidden = {}, formId = "job-filters", submitOnChange = true, keyword = true }: { filters: JobFilters; facets: FacetData; action?: string; hidden?: Record<string, string>; formId?: string; submitOnChange?: boolean; keyword?: boolean }) {
  const P = formId;
  return (
    <form id={formId} action={action} method="get" className="space-y-4" role="search" aria-label="Filter jobs">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {filters.sort ? <input type="hidden" name="sort" value={filters.sort} /> : null}
      {keyword ? (
        <div>
          <label htmlFor={`${P}-q`} className="mb-1.5 block text-sm font-medium text-ink">What</label>
          <input id={`${P}-q`} name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Title, skill or organization" className={fieldCls} />
        </div>
      ) : null}
      {!("country" in hidden) && !("region" in hidden) ? <WhereFields facets={facets} filters={filters} idPrefix={P} /> : null}
      {!("org" in hidden) ? <OrgFields facets={facets} filters={filters} idPrefix={P} /> : null}
      {!("category" in hidden) ? (
        <Select idPrefix={P} name="category" label="Category" value={filters.category} all="Any category" options={facets.categories.filter((c) => c.count > 0 || c.slug === filters.category).map((c) => ({ value: c.slug, label: withCount(c.name, c.count) }))} />
      ) : null}
      <GradeChecks facets={facets} filters={filters} />
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
          <MoreFilterFields idPrefix={P} filters={filters} facets={facets} hideOrgType={"orgtype" in hidden} />
        </div>
      </details>
      {/* Outside "More filters": it also applies to the grade boxes above. */}
      <UnstatedToggle filters={filters} idPrefix={P} />
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" className="flex-1 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-accent">Show jobs</button>
        <Link href={jobsUrl({}, action)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-accent hover:bg-mist">Clear</Link>
      </div>
      <AutoSubmit formId={formId} onChange={submitOnChange} />
    </form>
  );
}

/**
 * "What should we watch for?": optional keyword, organization and location fields INSIDE the alert
 * sign-up form (no form of their own, so nothing typed is lost). The server turns them into the
 * saved search (searchFromSignupForm in src/lib/saved-searches.ts). `hideLegend`: the legend is
 * for screen readers only, where a visible heading already names the fields (the folded fields of
 * the free weekly form).
 */
export function WatchFieldset({ facets, filters, hint, hideLegend = false }: { facets: FacetData; filters: JobFilters; hint?: React.ReactNode; hideLegend?: boolean }) {
  return (
    <fieldset className="space-y-4">
      <legend className={hideLegend ? "sr-only" : "text-lg font-semibold text-ink"}>
        What should we watch for? <span className="text-sm font-normal text-slate">(optional)</span>
      </legend>
      <p className={`${hideLegend ? "" : "-mt-2 "}text-sm text-slate`}>{hint ??`Leave these empty to get every new vacancy.${BILLING_LIVE ? " You can add up to 5 searches later." : ""}`}</p>
      <div>
        <label htmlFor="watch-q" className="mb-1.5 block text-sm font-medium text-ink">Keywords</label>
        <input id="watch-q" name="watch_q" type="text" defaultValue={filters.q ?? ""} maxLength={120} placeholder="e.g. data analyst, WASH, monitoring" className={fieldCls} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <OrgFields idPrefix="watch" name="watch_org" facets={facets} filters={filters} counts={false} />
        <WhereFields idPrefix="watch" name="watch_where" facets={facets} filters={filters} label="Location" />
      </div>
    </fieldset>
  );
}
