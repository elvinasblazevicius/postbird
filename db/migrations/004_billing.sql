-- Paid email alerts with Paddle Billing. Safe to run more than once.

-- ── Subscriber billing fields ────────────────────────────────
-- Mirrors the subscriber's Paddle subscription. Only what Paddle sends in its
-- webhooks is stored: no card or payment details ever reach this database.
alter table subscribers add column if not exists paddle_customer_id text;
alter table subscribers add column if not exists paddle_subscription_id text;
alter table subscribers add column if not exists billing_status text not null default 'none'
  check (billing_status in ('none', 'trialing', 'active', 'past_due', 'paused', 'canceled'));
alter table subscribers add column if not exists plan_interval text check (plan_interval in ('month', 'quarter'));
alter table subscribers add column if not exists trial_ends_at timestamptz;
alter table subscribers add column if not exists current_period_end timestamptz;
alter table subscribers add column if not exists canceled_at timestamptz;
-- A cancellation the customer scheduled for the end of the trial or billing period.
alter table subscribers add column if not exists cancel_at timestamptz;
-- occurred_at of the last Paddle event applied, so late, out-of-order events are ignored.
alter table subscribers add column if not exists billing_event_at timestamptz;
-- Set once the welcome email (with the account link) has been sent.
alter table subscribers add column if not exists welcome_sent_at timestamptz;

-- Secret for the account page (/account?t=...). gen_random_uuid() uses the
-- server's strong random source; two of them give about 244 random bits.
alter table subscribers add column if not exists manage_token text;
alter table subscribers alter column manage_token set default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
update subscribers set manage_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where manage_token is null;
alter table subscribers alter column manage_token set not null;

create unique index if not exists subscribers_manage_token_idx on subscribers (manage_token);
create unique index if not exists subscribers_paddle_subscription_idx on subscribers (paddle_subscription_id);
create index if not exists subscribers_paddle_customer_idx on subscribers (paddle_customer_id);
create index if not exists subscribers_billing_status_idx on subscribers (billing_status) where billing_status <> 'none';

-- ── Saved searches ───────────────────────────────────────────
-- 001_init created an unused placeholder table with a different shape
-- (query jsonb). Replace it while it is still empty.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'saved_searches' and column_name = 'query')
     and not exists (select 1 from saved_searches) then
    drop table saved_searches;
  end if;
end $$;

create table if not exists saved_searches (
  id bigserial primary key,
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  search text not null default '',     -- the /jobs query string, e.g. "q=data&region=africa" ('' = every new vacancy)
  label text,                          -- plain-language description shown in emails and on the account page
  created_at timestamptz not null default now(),
  last_sent_at timestamptz             -- matches first seen up to this time have been emailed
);
create unique index if not exists saved_searches_subscriber_search_idx on saved_searches (subscriber_id, search);
alter table saved_searches enable row level security;

-- At most 5 saved searches per subscriber. Locking the subscriber row first
-- makes two simultaneous inserts wait for each other, so neither can slip past.
create or replace function saved_searches_limit() returns trigger language plpgsql as $$
begin
  perform 1 from subscribers where id = new.subscriber_id for update;
  if (select count(*) from saved_searches where subscriber_id = new.subscriber_id) >= 5 then
    raise exception 'saved search limit reached' using errcode = 'P0001', hint = 'saved_searches_limit';
  end if;
  return new;
end $$;
drop trigger if exists saved_searches_limit on saved_searches;
create trigger saved_searches_limit before insert on saved_searches
  for each row execute function saved_searches_limit();

-- ── Checkouts started on the site ────────────────────────────
-- The opaque reference passed to Paddle as customData; the webhook uses it to
-- find the subscriber and the search they picked. Deleted after 30 days.
create table if not exists paddle_checkouts (
  ref text primary key,
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'quarterly')),
  search text,
  new_subscriber boolean not null default false,  -- the subscriber row was created by this checkout
  visitor text,                                    -- daily analytics hash, so the trial counts toward the right visit
  subscription_id text,                            -- set when the webhook links the subscription
  created_at timestamptz not null default now()
);
create index if not exists paddle_checkouts_created_idx on paddle_checkouts (created_at);
alter table paddle_checkouts enable row level security;

-- ── Webhook idempotency ──────────────────────────────────────
-- Paddle delivers at least once; an event_id seen before is ignored.
create table if not exists paddle_events (
  event_id text primary key,
  event_type text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);
alter table paddle_events enable row level security;

insert into schema_migrations (name) values ('004_billing') on conflict do nothing;
