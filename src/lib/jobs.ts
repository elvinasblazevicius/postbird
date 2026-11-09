import { ALL_CATEGORIES, categoryBySlug } from "@/config/categories";
import { countryByCode, countryBySlug } from "@/config/countries";
import { GRADE_GROUPS, LANGUAGES, ORG_TYPES, REGIONS, regionBySlug } from "@/config/regions";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";
import { interpretQuery, wordPattern } from "@/lib/search-intent";

export type JobListItem = {
  id: number;
  slug: string;
  title: string;
  org_name: string | null;
  org_slug: string | null;
  org_short: string | null;
  /** Organization slug when it has a stored icon (served from /api/org-logo/<slug>). */
  org_logo: string | null;
  country_code: string | null;
  city: string | null;
  location_text: string | null;
  is_remote: boolean | null;
  category: string;
  job_type: string | null;
  grade: string | null;
  published_at: Date | null;
  first_seen_at: Date;
  deadline: string | null;
  status: string;
  is_demo: boolean;
};

export type JobDetail = JobListItem & {
  summary: string | null;
  description_html: string | null;
  content_policy: string;
  apply_url: string;
  apply_host: string;
  reference: string | null;
  org_type: string | null;
  updated_at: Date;
  last_seen_at: Date;
  sources: { source_title: string | null; feed_name: string; item_url: string | null }[];
};

export const JOB_TYPES = ["Fixed-term", "Temporary", "Consultancy", "Internship", "Fellowship", "Volunteer", "Part-time"] as const;

export const EXPERIENCE_BANDS = [
  { value: "0-2", name: "Up to 2 years", min: 0, max: 2 },
  { value: "3-5", name: "3–5 years", min: 3, max: 5 },
  { value: "6-9", name: "6–9 years", min: 6, max: 9 },
  { value: "10+", name: "10 years or more", min: 10, max: 99 },
] as const;

export type JobFilters = {
  q?: string;
  org?: string;
  country?: string; // country slug
  region?: string; // region slug
  grade?: string; // grade group ("P", "NO", "entry"…) or exact grade ("P-3")
  orgtype?: string;
  lang?: string;
  exp?: string;
  category?: string;
  remote?: boolean;
  type?: string;
  posted?: "1" | "7" | "30";
  closing?: "7" | "30";
  sort?: "newest" | "deadline" | "relevance";
  page?: number;
  /** Email alerts only (never read from the URL): first seen after / up to these times, and no demo listings. */
  firstSeenAfter?: Date;
  firstSeenUntil?: Date;
  excludeDemo?: boolean;
};

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Read filters from the URL, ignoring anything invalid. */
export function parseFilters(sp: SP): JobFilters {
  const f: JobFilters = {};
  const q = first(sp.q);
  if (q) f.q = q.slice(0, 120);
  const org = first(sp.org);
  if (org && /^[a-z0-9-]{1,80}$/.test(org)) f.org = org;
  // "where" is the combined region/country field used by the search forms.
  const where = first(sp.where);
  if (where?.startsWith("region-") && regionBySlug(where.slice(7))) f.region = where.slice(7);
  else if (where && countryBySlug(where)) f.country = where;
  const country = first(sp.country);
  if (country && countryBySlug(country)) f.country = country;
  const region = first(sp.region);
  if (region && regionBySlug(region)) f.region = region;
  const grade = first(sp.grade);
  if (grade && (GRADE_GROUPS.some((g) => g.value === grade) || /^(P|D|NO|G|GS|FS)-[0-9A-E]$|^(ASG|USG)$|^(SB|LICA|NPSA|IPSA|ICS)-\d{1,2}$/.test(grade))) f.grade = grade;
  const orgtype = first(sp.orgtype);
  if (orgtype && ORG_TYPES.some((o) => o.value === orgtype)) f.orgtype = orgtype;
  const lang = first(sp.lang);
  if (lang && (LANGUAGES as readonly string[]).includes(lang)) f.lang = lang;
  const exp = first(sp.exp);
  if (exp && EXPERIENCE_BANDS.some((b) => b.value === exp)) f.exp = exp;
  const category = first(sp.category);
  if (category && categoryBySlug(category)) f.category = category;
  if (first(sp.remote) === "1" || first(sp.remote) === "true") f.remote = true;
  const type = first(sp.type);
  if (type && (JOB_TYPES as readonly string[]).includes(type)) f.type = type;
  const posted = first(sp.posted);
  if (posted === "1" || posted === "7" || posted === "30") f.posted = posted;
  const closing = first(sp.closing);
  if (closing === "7" || closing === "30") f.closing = closing;
  const sort = first(sp.sort);
  if (sort === "deadline" || sort === "relevance" || sort === "newest") f.sort = sort;
  const page = Number(first(sp.page));
  if (Number.isInteger(page) && page > 1 && page < 1000) f.page = page;
  return f;
}

/** Build a shareable /jobs URL for a set of filters. */
export function jobsUrl(f: JobFilters, base = "/jobs"): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.org) p.set("org", f.org);
  if (f.country) p.set("country", f.country);
  if (f.region) p.set("region", f.region);
  if (f.grade) p.set("grade", f.grade);
  if (f.orgtype) p.set("orgtype", f.orgtype);
  if (f.lang) p.set("lang", f.lang);
  if (f.exp) p.set("exp", f.exp);
  if (f.category) p.set("category", f.category);
  if (f.remote) p.set("remote", "1");
  if (f.type) p.set("type", f.type);
  if (f.posted) p.set("posted", f.posted);
  if (f.closing) p.set("closing", f.closing);
  if (f.sort && f.sort !== "newest") p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function activeFilterCount(f: JobFilters): number {
  return [f.q, f.org, f.country, f.region, f.grade, f.orgtype, f.lang, f.exp, f.category, f.remote, f.type, f.posted, f.closing].filter(Boolean).length;
}

/** A listing is shown while active and not past its published closing date (checked at query time, between syncs). */
const isOpen = () => sql`j.status = 'active' and (j.deadline is null or j.deadline >= (now() at time zone 'utc')::date)`;

/** Apply what the search words mean ("un", "remote", "internship", a country) as filters. */
export function withSearchIntent(f: JobFilters): JobFilters {
  if (!f.q) return f;
  const i = interpretQuery(f.q);
  return {
    ...f,
    q: i.text ?? undefined,
    orgtype: f.orgtype ?? i.orgtype,
    remote: f.remote || i.remote || undefined,
    type: f.type ?? i.type,
    country: f.country ?? (f.region ? undefined : i.country),
    sort: !i.text && f.sort === "relevance" ? undefined : f.sort,
  };
}

const listColumns = () => sql`
  j.id::int as id, j.slug, j.title, o.name as org_name, o.slug as org_slug, o.short_name as org_short,
  case when o.logo is not null and coalesce(o.org_type, '') not in ('UN system', 'EU institution') then o.slug end as org_logo,
  j.country_code, j.city, j.location_text, j.is_remote, j.category, j.job_type, j.grade,
  j.published_at, j.first_seen_at, j.deadline::text as deadline, j.status, j.is_demo`;

function whereFor(f: JobFilters) {
  let w = isOpen();
  if (f.q) {
    // Every word must appear as a word (not inside another word: "un" never matches "fund") in the title or organization,
    // or the words match the full text.
    let all = sql`true`;
    for (const t of f.q.split(" ").filter(Boolean).slice(0, 8)) {
      const p = wordPattern(t);
      all = sql`${all} and (j.title ~* ${p} or coalesce(o.name, '') ~* ${p} or coalesce(o.short_name, '') ~* ${p})`;
    }
    w = sql`${w} and (j.search_vector @@ websearch_to_tsquery('simple', ${f.q}) or (${all}))`;
  }
  if (f.org) w = sql`${w} and o.slug = ${f.org}`;
  if (f.country) {
    const c = countryBySlug(f.country);
    w = sql`${w} and j.country_code = ${c?.code ?? "--"}`;
  }
  if (f.region) w = sql`${w} and j.country_code = any(${regionBySlug(f.region)?.codes ?? []})`;
  if (f.grade) {
    const group = GRADE_GROUPS.find((g) => g.value === f.grade);
    if (group?.value === "SC") w = sql`${w} and j.grade ~ '^(SB|LICA|NPSA|IPSA|ICS)-'`;
    else if (group) w = sql`${w} and j.grade = any(${group.grades})`;
    else w = sql`${w} and j.grade = ${f.grade}`;
  }
  if (f.orgtype) w = sql`${w} and o.org_type = ${ORG_TYPES.find((o) => o.value === f.orgtype)?.type ?? "--"}`;
  if (f.lang) w = sql`${w} and ${f.lang} = any(j.languages)`;
  if (f.exp) {
    const band = EXPERIENCE_BANDS.find((b) => b.value === f.exp)!;
    w = sql`${w} and j.min_experience_years between ${band.min} and ${band.max}`;
  }
  if (f.category) w = sql`${w} and j.category = ${f.category}`;
  if (f.remote) w = sql`${w} and j.is_remote is true`;
  if (f.type) w = sql`${w} and j.job_type = ${f.type}`;
  if (f.posted) w = sql`${w} and coalesce(j.published_at, j.first_seen_at) >= now() - make_interval(days => ${Number(f.posted)})`;
  if (f.closing) w = sql`${w} and j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + ${Number(f.closing)}::int`;
  if (f.firstSeenAfter) w = sql`${w} and j.first_seen_at > ${f.firstSeenAfter}`;
  if (f.firstSeenUntil) w = sql`${w} and j.first_seen_at <= ${f.firstSeenUntil}`;
  if (f.excludeDemo) w = sql`${w} and not j.is_demo`;
  return w;
}

export async function searchJobs(input: JobFilters, pageSize: number = LISTING_SETTINGS.pageSize) {
  const f = withSearchIntent(input);
  const page = f.page ?? 1;
  const where = whereFor(f);
  const sort = f.sort ?? (f.q ? "relevance" : "newest");
  const order =
    sort === "deadline" ? sql`j.deadline asc nulls last, coalesce(j.published_at, j.first_seen_at) desc` :
    sort === "relevance" && f.q ? sql`ts_rank(j.search_vector, websearch_to_tsquery('simple', ${f.q})) desc, coalesce(j.published_at, j.first_seen_at) desc` :
    sql`coalesce(j.published_at, j.first_seen_at) desc, j.id desc`;
  const [items, [{ count }]] = await Promise.all([
    sql<JobListItem[]>`
      select ${listColumns()}
      from jobs j left join organizations o on o.id = j.organization_id
      where ${where}
      order by ${order}
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
    sql<{ count: number }[]>`select count(*)::int as count from jobs j left join organizations o on o.id = j.organization_id where ${where}`,
  ]);
  return { items, total: Number(count), page, pageSize, pages: Math.max(1, Math.ceil(Number(count) / pageSize)), sort };
}

export async function latestJobs(limit = 8) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()}
    order by (o.org_type = 'UN system' and coalesce(j.published_at, j.first_seen_at) >= now() - interval '10 days') desc nulls last,
             coalesce(j.published_at, j.first_seen_at) desc, j.id desc
    limit ${limit}`;
}

/** Open jobs with the nearest published closing dates (from today). */
export async function closingSoonJobs(limit = 6) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()} and j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + 14
    order by j.deadline asc, coalesce(j.published_at, j.first_seen_at) desc limit ${limit}`;
}

export async function getJob(id: number): Promise<JobDetail | null> {
  const rows = await sql<JobDetail[]>`
    select ${listColumns()}, j.summary, j.description_html, j.content_policy, j.apply_url, j.apply_host, j.reference,
           o.org_type, j.updated_at, j.last_seen_at
    from jobs j left join organizations o on o.id = j.organization_id
    where j.id = ${id}`;
  const job = rows[0];
  if (!job) return null;
  job.sources = await sql<JobDetail["sources"]>`
    select s.source_title, f.name as feed_name, s.item_url from job_sources s join feeds f on f.id = s.feed_id
    where s.job_id = ${id} order by s.first_seen_at`;
  return job;
}

export async function similarJobs(job: JobDetail, limit = 4) {
  return sql<JobListItem[]>`
    select ${listColumns()} from jobs j left join organizations o on o.id = j.organization_id
    where ${isOpen()} and j.id <> ${job.id} and (j.category = ${job.category} or o.slug = ${job.org_slug ?? "--"})
    order by (o.slug = ${job.org_slug ?? "--"}) desc nulls last, coalesce(j.published_at, j.first_seen_at) desc limit ${limit}`;
}

// ── Facets & stats ───────────────────────────────────────────

export async function organizationFacets(limit = 500, includeDemo = true) {
  return sql<{ slug: string; name: string; short_name: string | null; org_type: string | null; logo: string | null; count: number }[]>`
    select o.slug, o.name, o.short_name, o.org_type, case when o.logo is not null and coalesce(o.org_type, '') not in ('UN system', 'EU institution') then o.slug end as logo, count(*)::int as count
    from jobs j join organizations o on o.id = j.organization_id
    where ${isOpen()} and (${includeDemo} or not j.is_demo) group by o.id order by count(*) desc, o.name limit ${limit}`;
}

export async function countryFacets(includeDemo = true) {
  const rows = await sql<{ country_code: string; count: number }[]>`
    select j.country_code, count(*)::int as count from jobs j
    where ${isOpen()} and j.country_code is not null and (${includeDemo} or not j.is_demo) group by j.country_code order by count(*) desc`;
  return rows
    .map((r) => ({ ...r, country: countryByCode(r.country_code) }))
    .filter((r) => r.country)
    .map((r) => ({ code: r.country_code, slug: r.country!.slug, name: r.country!.name, count: r.count }));
}

export async function categoryFacets(includeDemo = true) {
  const rows = await sql<{ category: string; count: number }[]>`
    select j.category, count(*)::int as count from jobs j where ${isOpen()} and (${includeDemo} or not j.is_demo) group by j.category`;
  const counts = new Map(rows.map((r) => [r.category, r.count]));
  return ALL_CATEGORIES.map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }));
}

export async function regionFacets(includeDemo = true) {
  const countries = await countryFacets(includeDemo);
  return REGIONS.map((r) => ({ slug: r.slug, name: r.name, count: countries.filter((c) => r.codes.includes(c.code)).reduce((n, c) => n + c.count, 0) }));
}

export async function gradeFacets() {
  return sql<{ grade: string; count: number }[]>`
    select j.grade, count(*)::int as count from jobs j where ${isOpen()} and j.grade is not null group by j.grade order by j.grade`;
}

export async function languageFacets() {
  return sql<{ lang: string; count: number }[]>`
    select l as lang, count(*)::int as count from jobs j, unnest(j.languages) l where ${isOpen()} group by l order by count(*) desc`;
}

export async function experienceFacets() {
  const rows = await sql<{ y: number; count: number }[]>`
    select j.min_experience_years as y, count(*)::int as count from jobs j where ${isOpen()} and j.min_experience_years is not null group by 1`;
  return EXPERIENCE_BANDS.map((b) => ({ ...b, count: rows.filter((r) => r.y >= b.min && r.y <= b.max).reduce((n, r) => n + r.count, 0) }));
}

export async function orgTypeFacets() {
  const rows = await sql<{ org_type: string; count: number }[]>`
    select o.org_type, count(*)::int as count from jobs j join organizations o on o.id = j.organization_id
    where ${isOpen()} and o.org_type is not null group by o.org_type`;
  return ORG_TYPES.map((t) => ({ ...t, count: rows.find((r) => r.org_type === t.type)?.count ?? 0 }));
}

export async function jobTypeFacets() {
  return sql<{ job_type: string; count: number }[]>`
    select j.job_type, count(*)::int as count from jobs j where ${isOpen()} and j.job_type is not null group by j.job_type order by count(*) desc`;
}

export async function siteStats() {
  const [r] = await sql<{ active: number; orgs: number; countries: number; remote: number; this_week: number }[]>`
    select count(*)::int as active,
           count(distinct j.organization_id)::int as orgs,
           count(distinct j.country_code)::int as countries,
           count(*) filter (where j.is_remote)::int as remote,
           count(*) filter (where coalesce(j.published_at, j.first_seen_at) >= now() - interval '7 days')::int as this_week
    from jobs j where ${isOpen()}`;
  return r;
}

export async function getOrganization(slug: string) {
  const rows = await sql<{ id: number; slug: string; name: string; short_name: string | null; org_type: string | null; logo: string | null }[]>`
    select id, slug, name, short_name, org_type, case when logo is not null and coalesce(org_type, '') not in ('UN system', 'EU institution') then slug end as logo from organizations where slug = ${slug}`;
  return rows[0] ?? null;
}

export async function hasDemoJobs(): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs j where j.is_demo and ${isOpen()}`;
  return r.n > 0;
}
