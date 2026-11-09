-- Free weekly email: one saved search per free subscriber, sent on Mondays.
-- Safe to run more than once.

-- ── Subscribers ──────────────────────────────────────────────
-- true once the address confirmed a sign-up for the free weekly email. Paid
-- subscribers (trial, active, payment overdue or paused) never get it; if
-- their plan ends, they get it only if they had signed up for it.
alter table subscribers add column if not exists weekly_email boolean not null default false;

-- Addresses that confirmed the earlier free weekly round-up (wants_alerts
-- without ever having a plan) keep getting it. Runs once, before this
-- migration is recorded, so later sign-ups are never switched on here.
do $$
begin
  if not exists (select 1 from schema_migrations where name = '008_free_weekly_email') then
    update subscribers set weekly_email = true
    where status = 'confirmed' and wants_alerts and not weekly_email
      and billing_status = 'none' and paddle_subscription_id is null;
  end if;
end $$;

create index if not exists subscribers_weekly_email_idx on subscribers (id) where weekly_email and status = 'confirmed';

-- ── Saved searches ───────────────────────────────────────────
-- Free subscribers keep one saved search (the one their weekly email uses);
-- a plan (trial, active, payment overdue or paused) allows 5. Searches kept
-- from an ended plan are not deleted, but no new one can be added beyond 1.
-- Locking the subscriber row first makes two simultaneous inserts wait for
-- each other, so neither can slip past.
create or replace function saved_searches_limit() returns trigger language plpgsql as $$
declare
  lim int;
begin
  select case when billing_status in ('trialing', 'active', 'past_due', 'paused') then 5 else 1 end into lim
  from subscribers where id = new.subscriber_id for update;
  if (select count(*) from saved_searches where subscriber_id = new.subscriber_id) >= coalesce(lim, 1) then
    raise exception 'saved search limit reached' using errcode = 'P0001',
      hint = case when coalesce(lim, 1) = 1 then 'saved_searches_free_limit' else 'saved_searches_limit' end;
  end if;
  return new;
end $$;
drop trigger if exists saved_searches_limit on saved_searches;
create trigger saved_searches_limit before insert on saved_searches
  for each row execute function saved_searches_limit();

insert into schema_migrations (name) values ('008_free_weekly_email') on conflict do nothing;
