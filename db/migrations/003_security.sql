-- Security hardening. Safe to run more than once.

-- Small key/value settings. "admin_session_version" is part of every admin
-- session; signing out increases it, which ends every admin session at once.
create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into settings (key, value) values ('admin_session_version', '1') on conflict (key) do nothing;

-- Fixed-window rate limits. "key" is a salted one-way hash (never a raw IP
-- address); rows are deleted after 24 hours.
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);

-- Organizations whose icon must never be shown (e.g. the organization objected).
-- Blocked organizations are also kept when they have no listings, so the block
-- survives the sync's clean-up of unused organizations.
alter table organizations add column if not exists logo_blocked boolean not null default false;
-- The earlier opt-out (logo_checked_at = '9999-01-01') becomes a block.
update organizations set logo_blocked = true, logo = null, logo_type = null
where logo_checked_at >= '9999-01-01' and not logo_blocked;

create index if not exists admin_login_failures_at_idx on admin_login_failures (at);
create index if not exists sync_runs_running_idx on sync_runs (started_at) where status = 'running';

alter table settings enable row level security;
alter table rate_limits enable row level security;

insert into schema_migrations (name) values ('003_security') on conflict do nothing;
