-- A plan that goes live starts daily alerts at once, and only an address that was never
-- confirmed can be waiting for confirmation. Additive only. Safe to run more than once.

-- ── When the current plan went live ─────────────────────────
-- Set when a new Paddle subscription is first applied with a running status (applySubscription
-- in src/lib/billing/subscriptions.ts). runAlerts (src/lib/digest.ts) treats the subscriber as due
-- until an alert went out after this time, and never looks back before it (beyond one normal
-- window), so the first paid alert comes with the next daily run without repeating what the free
-- weekly email already sent. Null for plans that went live before this column existed.
alter table subscribers add column if not exists plan_started_at timestamptz;

-- ── Waiting for the address to be confirmed ─────────────────
-- A plan can only be linked to an unproven address when that address was never confirmed. A
-- confirmed owner who later unsubscribed stays proven, even if someone else then types the
-- address into a sign-up form (which sets a new confirm_token): their trial gets its reminder
-- and is never canceled for want of confirmation. Same rule as awaitingConfirmation() in
-- src/lib/billing/subscriptions.ts (a test checks both agree).
create or replace function awaiting_confirmation(s subscribers) returns boolean
language sql immutable parallel safe as $$
  select s.status <> 'confirmed' and s.confirmed_at is null
$$;

insert into schema_migrations (name) values ('017_paid_start') on conflict do nothing;
