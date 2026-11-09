-- Trial reminders, early-access notice, retention and an index for the alert
-- queries. Safe to run more than once.

-- ── Subscribers ──────────────────────────────────────────────
-- Set once the "your trial ends soon" email has been sent (at most one per subscriber).
alter table subscribers add column if not exists trial_reminder_sent_at timestamptz;
-- Set once the early-access list member got the "email alerts are open" email.
-- Waitlist-only rows are deleted 30 days later unless they started a trial.
alter table subscribers add column if not exists waitlist_notified_at timestamptz;

-- ── Jobs ─────────────────────────────────────────────────────
-- Paid alerts and the weekly digest look for open listings by first_seen_at.
create index if not exists jobs_first_seen_active_idx on jobs (first_seen_at) where status = 'active';

-- ── Organization icons ───────────────────────────────────────
-- UN and EU emblems are protected and are never stored or shown; icons
-- fetched for those organizations before this rule are removed here (the
-- scheduled import repeats this clean-up for organizations whose type changes).
update organizations set logo = null, logo_type = null
where org_type in ('UN system', 'EU institution') and logo is not null;

insert into schema_migrations (name) values ('005_reminders_retention') on conflict do nothing;
