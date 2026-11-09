-- One trial per person across address variants, address proof at checkout,
-- an admin-visible log of unexpected errors, and two missing indexes.
-- Safe to run more than once.

-- ── Canonical address for the one-trial rule ─────────────────
-- Used only to compare addresses for the one-free-trial rule, never to send
-- email: lowercase, no "+suffix" in the local part (any domain), and for
-- Gmail no dots in the local part, with googlemail.com counted as gmail.com.
-- Must stay identical to canonicalTrialEmail() in
-- src/lib/billing/trial-markers.ts (a test checks both agree).
create or replace function canonical_trial_email(addr text) returns text
language plpgsql immutable parallel safe as $$
declare
  e text := lower(btrim(addr));
  pos int;
  loc text;
  dom text;
  plus int;
begin
  if e is null then return null; end if;
  pos := strpos(e, '@');
  if pos = 0 then return e; end if;
  loc := left(e, pos - 1);
  dom := substr(e, pos + 1);
  plus := strpos(loc, '+');
  if plus > 1 then loc := left(loc, plus - 1); end if;
  if dom in ('gmail.com', 'googlemail.com') then
    dom := 'gmail.com';
    loc := coalesce(nullif(replace(loc, '.', ''), ''), loc);
  end if;
  return loc || '@' || dom;
end $$;

alter table subscribers add column if not exists canonical_email text;
update subscribers set canonical_email = canonical_trial_email(email)
where canonical_email is distinct from canonical_trial_email(email);
create index if not exists subscribers_canonical_email_idx on subscribers (canonical_email);

-- Kept up to date on every insert and every change of the address.
create or replace function subscribers_set_canonical_email() returns trigger
language plpgsql as $$
begin
  new.canonical_email := canonical_trial_email(new.email);
  return new;
end $$;
drop trigger if exists subscribers_canonical_email on subscribers;
create trigger subscribers_canonical_email
  before insert or update of email on subscribers
  for each row execute function subscribers_set_canonical_email();

-- ── Checkouts: does paying prove the address? ────────────────
-- true only for a checkout opened from the single-use link emailed to the
-- address (/account/continue): opening it proves the mailbox, so paying
-- confirms the address. A checkout from the public trial form never does:
-- its address gets a confirmation email after the trial (or plan) starts,
-- and alerts start once it is confirmed. Rows from before this migration:
-- a checkout without a trial only ever came from an emailed link.
alter table paddle_checkouts add column if not exists address_proven boolean not null default false;
update paddle_checkouts set address_proven = true where not address_proven and trial_allowed = false and new_subscriber;

-- ── Indexes for "on delete cascade" and per-subscriber lookups ──
create index if not exists paddle_checkouts_subscriber_idx on paddle_checkouts (subscriber_id);
create index if not exists checkout_links_subscriber_idx on checkout_links (subscriber_id);

-- ── Unexpected errors (Admin → Overview) ─────────────────────
-- Recorded when the Paddle webhook or a scheduled job (import, emails) hits
-- an error it didn't expect. One open row per source and message; a repeat
-- raises count and last_at. No personal data (no addresses, no payloads).
-- "Mark dealt with" sets resolved_at; resolved rows go after 90 days.
create table if not exists ops_events (
  id bigserial primary key,
  source text not null,
  message text not null,
  count integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists ops_events_open_idx on ops_events (source, message) where resolved_at is null;
alter table ops_events enable row level security;

insert into schema_migrations (name) values ('012_ops_and_canonical_email') on conflict do nothing;
