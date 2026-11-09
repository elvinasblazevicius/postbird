-- "Closing in the next 3 days" in paid alerts: which vacancies each subscriber has already had in
-- that section, so a vacancy is listed there at most once per subscriber (src/lib/digest.ts).
-- Rows are deleted with the subscriber or the listing, and after 60 days by the retention
-- clean-up (src/lib/feeds/sync.ts), long after any listed vacancy has closed.
-- Safe to run more than once.

create table if not exists alert_closing_sent (
  subscriber_id bigint not null references subscribers(id) on delete cascade,
  job_id bigint not null references jobs(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (subscriber_id, job_id)
);

-- For "on delete cascade" from jobs and for the retention clean-up.
create index if not exists alert_closing_sent_job_idx on alert_closing_sent (job_id);
create index if not exists alert_closing_sent_sent_at_idx on alert_closing_sent (sent_at);

insert into schema_migrations (name) values ('014_alert_closing_sent') on conflict do nothing;
