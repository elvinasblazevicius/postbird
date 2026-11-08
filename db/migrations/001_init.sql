-- Global Careers Hub — database schema (PostgreSQL 15+ / Supabase)
-- Safe to run more than once.

create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- ── Feeds ────────────────────────────────────────────────────
create table if not exists feeds (
  id bigserial primary key,
  name text not null,
  url text not null unique,
  -- Organization to use for every item of this feed when the feed is
  -- dedicated to one employer (leave empty for mixed feeds).
  default_organization text,
  -- What may be republished: none = metadata + link, excerpt, full.
  content_policy text not null default 'none' check (content_policy in ('none', 'excerpt', 'full')),
  is_active boolean not null default true,
  from_env boolean not null default false,  -- added automatically from INOREADER_FEED_URLS
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  last_item_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Organizations ────────────────────────────────────────────
create table if not exists organizations (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  short_name text,
  org_type text,
  created_at timestamptz not null default now()
);

-- ── Jobs ─────────────────────────────────────────────────────
create table if not exists jobs (
  id bigserial primary key,
  slug text not null,
  title text not null,
  organization_id bigint references organizations(id) on delete set null,
  primary_feed_id bigint,          -- the feed whose data the listing uses
  country_code text,
  city text,
  location_text text,           -- location exactly as given by the source
  is_remote boolean,            -- null = not stated
  category text not null default 'other',
  category_locked boolean not null default false, -- set when an admin picks the category
  job_type text,
  grade text,
  languages text[],             -- languages named in the requirements (besides English)
  min_experience_years integer, -- "at least N years of experience", when stated
  reference text,               -- vacancy / requisition number from the source
  summary text,                 -- only stored when the feed's policy allows
  description_html text,        -- only stored when the feed's policy is 'full'
  content_policy text not null default 'none',
  apply_url text not null,
  apply_host text not null,
  url_hash text not null unique,
  fingerprint text,
  published_at timestamptz,
  deadline date,
  status text not null default 'active' check (status in ('active', 'expired', 'archived', 'removed')),
  removed_reason text,
  is_demo boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(location_text, '') || ' ' || coalesce(city, '') || ' ' || coalesce(grade, '') || ' ' || coalesce(job_type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'C')
  ) stored
);

create index if not exists jobs_status_published_idx on jobs (status, published_at desc);
create index if not exists jobs_status_deadline_idx on jobs (status, deadline);
create index if not exists jobs_org_idx on jobs (organization_id) where status = 'active';
create index if not exists jobs_category_idx on jobs (category) where status = 'active';
create index if not exists jobs_country_idx on jobs (country_code) where status = 'active';
create index if not exists jobs_fingerprint_idx on jobs (fingerprint);
create index if not exists jobs_grade_idx on jobs (grade) where status = 'active';
create index if not exists jobs_languages_idx on jobs using gin (languages);
create index if not exists jobs_search_idx on jobs using gin (search_vector);

-- Which feed(s) each job came from (for attribution and duplicate checks).
create table if not exists job_sources (
  job_id bigint not null references jobs(id) on delete cascade,
  feed_id bigint not null references feeds(id) on delete cascade,
  item_guid text,
  item_url text,
  source_title text,            -- original publisher / feed name given in the item
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (job_id, feed_id)
);

-- ── Sync history ─────────────────────────────────────────────
create table if not exists sync_runs (
  id bigserial primary key,
  trigger text not null,        -- cron | manual | cli
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  feeds_total integer not null default 0,
  feeds_failed integer not null default 0,
  items_seen integer not null default 0,
  jobs_created integer not null default 0,
  jobs_updated integer not null default 0,
  jobs_unchanged integer not null default 0,
  duplicates integer not null default 0,
  items_failed integer not null default 0,
  jobs_expired integer not null default 0,
  message text
);

create table if not exists sync_items (
  id bigserial primary key,
  run_id bigint not null references sync_runs(id) on delete cascade,
  feed_id bigint references feeds(id) on delete set null,
  job_id bigint references jobs(id) on delete set null,
  outcome text not null check (outcome in ('created', 'updated', 'duplicate', 'skipped', 'failed', 'feed_error')),
  title text,
  url text,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists sync_items_run_idx on sync_items (run_id, outcome);

-- Simple lock so two syncs never run at the same time.
create table if not exists locks (
  name text primary key,
  locked_until timestamptz,
  holder text
);
insert into locks (name) values ('sync') on conflict do nothing;
insert into locks (name) values ('digest') on conflict do nothing;

-- ── Subscribers (job alerts + premium waitlist) ──────────────
create table if not exists subscribers (
  id bigserial primary key,
  email text not null unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  wants_alerts boolean not null default false,
  premium_waitlist boolean not null default false,
  waitlist_note text,
  frequency text not null default 'weekly' check (frequency in ('weekly', 'daily')),
  plan text not null default 'free' check (plan in ('free', 'premium')),
  preferences jsonb not null default '{}'::jsonb,   -- future: keywords, organizations, locations
  confirm_token text unique,
  unsubscribe_token text not null unique,
  source text,
  attribution jsonb,               -- first ad/campaign touch: utm_*, msclkid, landing page
  pending_changes jsonb,           -- changes requested by an already-confirmed address; applied only after it confirms again
  confirm_sent_at timestamptz,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  last_digest_at timestamptz,
  waitlist_joined_at timestamptz
);
create index if not exists subscribers_status_idx on subscribers (status);

-- ── Ready for paid plans later (Stripe); unused for now ──────
create table if not exists billing_customers (
  subscriber_id bigint primary key references subscribers(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists billing_subscriptions (
  id bigserial primary key,
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  provider text not null default 'stripe',
  provider_subscription_id text unique,
  plan text not null,
  status text not null,          -- mirrors Stripe: trialing, active, past_due, canceled...
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saved_searches (
  id bigserial primary key,
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  name text,
  query jsonb not null,          -- same keys as the /jobs URL filters
  frequency text not null default 'weekly',
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Email digests sent ───────────────────────────────────────
create table if not exists digests (
  id bigserial primary key,
  period_key text not null unique,   -- e.g. 2026-W45
  status text not null default 'running',
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  jobs_included integer not null default 0,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ── Analytics (first-party, cookieless) ──────────────────────
create table if not exists events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  type text not null,            -- pageview | job_view | search | apply_click | alert_signup | waitlist_signup | alert_confirmed
  path text,
  job_id bigint,
  visitor text,                  -- daily-rotating anonymous hash, no IP stored
  referrer text,
  props jsonb
);
create index if not exists events_type_time_idx on events (type, created_at desc);
create index if not exists events_job_idx on events (job_id) where job_id is not null;

-- Failed admin sign-ins (for rate limiting); kept briefly.
create table if not exists admin_login_failures (
  id bigserial primary key,
  who text not null,               -- daily-rotating hash of IP and browser
  at timestamptz not null default now()
);
create index if not exists admin_login_failures_idx on admin_login_failures (who, at);

-- ── Security: block direct access through Supabase's public API ──
-- The app connects to Postgres directly with its own credentials, so no
-- row-level policies are needed; enabling RLS with no policies means the
-- public "anon" API key cannot read or change anything.
alter table feeds enable row level security;
alter table organizations enable row level security;
alter table jobs enable row level security;
alter table job_sources enable row level security;
alter table sync_runs enable row level security;
alter table sync_items enable row level security;
alter table locks enable row level security;
alter table subscribers enable row level security;
alter table billing_customers enable row level security;
alter table billing_subscriptions enable row level security;
alter table saved_searches enable row level security;
alter table digests enable row level security;
alter table events enable row level security;
alter table schema_migrations enable row level security;
alter table admin_login_failures enable row level security;

insert into schema_migrations (name) values ('001_init') on conflict do nothing;
