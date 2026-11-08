import { ALL_CATEGORIES, categoryBySlug } from "@/config/categories";
import { countryByCode, countryBySlug } from "@/config/countries";
import { LISTING_SETTINGS } from "@/config/import";
import { sql } from "@/lib/db";

export type JobListItem = {
  id: number;
  slug: string;
  title: string;
  org_name: string | null;
  org_slug: string | null;
  org_short: string | null;
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

export type JobFilters = {
  q?: string;
  org?: string;
  country?: string; // country slug
  category?: string;
  remote?: boolean;
  type?: string;
  posted?: "1" | "7" | "30";
  closing?: "7" | "30";
  sort?: "newest" | "deadline" | "relevance";
  page?: number;
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
  const country = first(sp.country);
  if (country && countryBySlug(country)) f.country = country;
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
  return [f.q, f.org, f.country, f.category, f.remote, f.type, f.posted, f.closing].filter(Boolean).length;
}

const listColumns = () => sql`
  j.id::int as id, j.slug, j.title, o.name as org_name, o.slug as org_slug, o.short_name as org_short,
  j.country_code, j.city, j.location_text, j.is_remote, j.category, j.job_type, j.grade,
  j.published_at, j.first_seen_at, j.deadline::text as deadline, j.status, j.is_demo`;

function whereFor(f: JobFilters) {
  let w = sql`j.status = 'active'`;
  if (f.q) w = sql`${w} and (j.search_vector @@ websearch_to_tsquery('simple', ${f.q}) or j.title ilike ${"%" + f.q.replace(/[%_\\]/g, "") + "%"} or o.name ilike ${"%" + f.q.replace(/[%_\\]/g, "") + "%"})`;
  if (f.org) w = sql`${w} and o.slug = ${f.org}`;
  if (f.country) {
    const c = countryBySlug(f.country);
    w = sql`${w} and j.country_code = ${c?.code ?? "--"}`;
  }
  if (f.category) w = sql`${w} and j.category = ${f.category}`;
  if (f.remote) w = sql`${w} and j.is_remote is true`;
  if (f.type) w = sql`${w} and j.job_type = ${f.type}`;
  if (f.posted) w = sql`${w} and coalesce(j.published_at, j.first_seen_at) >= now() - make_interval(days => ${Number(f.posted)})`;
  if (f.closing) w = sql`${w} and j.deadline is not null and j.deadline <= (now() at time zone 'utc')::date + ${Number(f.closing)}`;
  return w;
}

export async function searchJobs(f: JobFilters, pageSize: number = LISTING_SETTINGS.pageSize) {
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
    where j.status = 'active' order by coalesce(j.published_at, j.first_seen_at) desc, j.id desc limit ${limit}`;
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
    where j.status = 'active' and j.id <> ${job.id} and (j.category = ${job.category} or o.slug = ${job.org_slug ?? "--"})
    order by (o.slug = ${job.org_slug ?? "--"}) desc nulls last, coalesce(j.published_at, j.first_seen_at) desc limit ${limit}`;
}

// ── Facets & stats ───────────────────────────────────────────

export async function organizationFacets(limit = 500) {
  return sql<{ slug: string; name: string; short_name: string | null; org_type: string | null; count: number }[]>`
    select o.slug, o.name, o.short_name, o.org_type, count(*)::int as count
    from jobs j join organizations o on o.id = j.organization_id
    where j.status = 'active' group by o.id order by count(*) desc, o.name limit ${limit}`;
}

export async function countryFacets() {
  const rows = await sql<{ country_code: string; count: number }[]>`
    select country_code, count(*)::int as count from jobs
    where status = 'active' and country_code is not null group by country_code order by count(*) desc`;
  return rows
    .map((r) => ({ ...r, country: countryByCode(r.country_code) }))
    .filter((r) => r.country)
    .map((r) => ({ code: r.country_code, slug: r.country!.slug, name: r.country!.name, count: r.count }));
}

export async function categoryFacets() {
  const rows = await sql<{ category: string; count: number }[]>`
    select category, count(*)::int as count from jobs where status = 'active' group by category`;
  const counts = new Map(rows.map((r) => [r.category, r.count]));
  return ALL_CATEGORIES.map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }));
}

export async function jobTypeFacets() {
  return sql<{ job_type: string; count: number }[]>`
    select job_type, count(*)::int as count from jobs where status = 'active' and job_type is not null group by job_type order by count(*) desc`;
}

export async function siteStats() {
  const [r] = await sql<{ active: number; orgs: number; countries: number; remote: number; this_week: number }[]>`
    select count(*)::int as active,
           count(distinct organization_id)::int as orgs,
           count(distinct country_code)::int as countries,
           count(*) filter (where is_remote)::int as remote,
           count(*) filter (where coalesce(published_at, first_seen_at) >= now() - interval '7 days')::int as this_week
    from jobs where status = 'active'`;
  return r;
}

export async function getOrganization(slug: string) {
  const rows = await sql<{ id: number; slug: string; name: string; short_name: string | null; org_type: string | null }[]>`
    select id, slug, name, short_name, org_type from organizations where slug = ${slug}`;
  return rows[0] ?? null;
}

export async function hasDemoJobs(): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from jobs where is_demo and status = 'active'`;
  return r.n > 0;
}
