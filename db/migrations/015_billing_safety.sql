-- Billing safety: trials at addresses that were never confirmed are canceled before they
-- turn into a payment, a second running subscription for one address is canceled, Paddle
-- cancels that failed are retried by the daily job, and one shared "had a plan" rule.
-- Also turns on row level security for the one table that was missing it.
-- Safe to run more than once.

-- ── Row level security ───────────────────────────────────────
-- Every table is reached only through the server's own connection; with RLS on and no
-- policies, Supabase's public API keys can't read or change it (as for every other table).
alter table alert_closing_sent enable row level security;

-- ── Billing flags (Admin → Overview) ─────────────────────────
-- New kinds:
--  duplicate_subscription  a second running subscription for an address that already has
--                          one (two checkouts finished at once); canceled in Paddle at once
--                          and never applied
--  trial_unconfirmed       a free trial at an address nobody confirmed, about to end;
--                          canceled in Paddle at once so nothing is charged
alter table billing_flags drop constraint if exists billing_flags_kind_check;
alter table billing_flags add constraint billing_flags_kind_check check (kind in (
  'trial_blocked', 'customer_mismatch', 'customer_unverified', 'duplicate_subscription', 'trial_unconfirmed'
));

-- When Paddle confirmed the cancel of a flagged subscription (trial_blocked,
-- duplicate_subscription, trial_unconfirmed). While it is null on an open flag, the daily
-- job tries the cancel again (src/lib/billing/subscriptions.ts, runBillingSafety).
alter table billing_flags add column if not exists cancel_done_at timestamptz;
-- Flags whose cancel went through before this column existed (their detail says so).
update billing_flags set cancel_done_at = updated_at
where cancel_done_at is null and kind = 'trial_blocked'
  and detail = 'Canceled in Paddle at once, so nothing is charged. Alerts stayed off; no welcome was sent.';

-- ── One "had a plan" rule ────────────────────────────────────
-- Has this address had a Paddle subscription while confirmed? The same test as
-- hadTrialBefore() in src/lib/billing/subscriptions.ts (a test checks both agree). Used by
-- the retention clean-up (trial markers), the one-trial checks and the early-access email.
create or replace function had_plan(s subscribers) returns boolean
language sql immutable parallel safe as $$
  select s.confirmed_at is not null
     and (s.paddle_subscription_id is not null or coalesce(s.billing_status, 'none') <> 'none'
          or s.trial_ends_at is not null or s.canceled_at is not null)
$$;

-- ── Waiting for the address to be confirmed ─────────────────
-- A plan was linked to this address without proof that its owner wants it, and the owner
-- hasn't confirmed since: never confirmed at all, or asked to confirm (confirm_token) and
-- not confirmed yet. Such a trial gets the confirmation email again (days 3 and 10), no
-- trial-ending reminder, and is canceled 2 days before it ends (src/lib/billing/notices.ts).
-- A confirmed owner who later unsubscribed from emails is not waiting (their token is cleared).
create or replace function awaiting_confirmation(s subscribers) returns boolean
language sql immutable parallel safe as $$
  select s.status <> 'confirmed' and (s.confirmed_at is null or s.confirm_token is not null)
$$;

insert into schema_migrations (name) values ('015_billing_safety') on conflict do nothing;
