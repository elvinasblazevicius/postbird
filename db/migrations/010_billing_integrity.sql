-- Billing integrity: trials the checkout didn't allow, Paddle customers checked
-- against the subscriber's address, emailed checkout links, and the one-trial
-- rule kept after an address is deleted. Safe to run more than once.

-- ── Checkouts started on the site ────────────────────────────
-- Whether this checkout may start a free trial: true for the catalog price
-- (a new address, or one that never had a plan), false for a returning
-- customer's checkout without a trial. A trialing subscription that arrives
-- for a reference with false is canceled in Paddle (see handlePaddleEvent).
-- Rows from before this migration have null and are judged by the
-- subscriber's plan history only.
alter table paddle_checkouts add column if not exists trial_allowed boolean;

-- ── Subscribers ──────────────────────────────────────────────
-- Set when paddle_customer_id was checked against Paddle (GET /customers/{id}):
-- the customer's email is this subscriber's address. A customer portal session
-- is only ever opened for a checked customer; ids stored before this migration
-- are checked the first time someone opens billing.
alter table subscribers add column if not exists paddle_customer_verified_at timestamptz;

-- ── Billing flags (Admin → Overview) ─────────────────────────
-- Subscriptions the webhook did not apply, for the owner to look at:
--  trial_blocked        a free trial this address may not have (one per email
--                       address); canceled in Paddle at once (detail says
--                       whether the cancel worked)
--  customer_mismatch    the Paddle customer's email is not the subscriber's
--                       address; nothing was linked and alerts stay off
--  customer_unverified  the customer couldn't be checked (no API key or
--                       Paddle unreachable); the plan was applied without
--                       linking the customer, and is checked again later
-- One row per subscription and kind. No email address is stored here.
create table if not exists billing_flags (
  subscription_id text not null,
  kind text not null check (kind in ('trial_blocked', 'customer_mismatch', 'customer_unverified')),
  subscriber_id bigint references subscribers(id) on delete cascade,
  customer_id text,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (subscription_id, kind)
);
create index if not exists billing_flags_open_idx on billing_flags (updated_at desc) where resolved_at is null;
alter table billing_flags enable row level security;

-- ── Checkout links (emailed) ─────────────────────────────────
-- An address that has or had a plan doesn't go straight to Paddle from the
-- public form (that would tell anyone who typed it that it is a customer).
-- It gets a single-use link by email instead, valid for 24 hours, to a page
-- with the right terms for that address. Only a SHA-256 of the link's token
-- is stored. Deleted once expired (purgeStaleSubscribers).
create table if not exists checkout_links (
  token_hash text primary key,
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'quarterly')),
  search text,
  visitor text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists checkout_links_expires_idx on checkout_links (expires_at);
alter table checkout_links enable row level security;

-- ── One free trial per email address, after deletion ─────────
-- When the retention clean-up deletes an address that had a plan, a one-way
-- code of it is kept (HMAC-SHA256 of the normalized address with a server
-- secret: not the address, and not reversible) for 24 months, only so that
-- the address doesn't get a second free trial. Deleted after expires_at.
create table if not exists trial_markers (
  hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists trial_markers_expires_idx on trial_markers (expires_at);
alter table trial_markers enable row level security;

insert into schema_migrations (name) values ('010_billing_integrity') on conflict do nothing;
