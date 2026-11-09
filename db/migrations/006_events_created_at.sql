-- Index for queries and clean-ups of analytics events by time alone (the
-- admin overview's counts, and the retention clean-up in every sync, which
-- deletes events older than the analytics retention period). The existing
-- (type, created_at) index only helps when the type is known.
-- Safe to run more than once.
create index if not exists events_created_at_idx on events (created_at);

insert into schema_migrations (name) values ('006_events_created_at') on conflict do nothing;
