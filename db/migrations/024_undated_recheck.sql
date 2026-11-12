-- When the employer's page of an undated open job was last checked for "still open?"
-- (src/lib/feeds/enrich.ts, recheckUndatedJobs), and what that check found.
alter table jobs add column if not exists live_checked_at timestamptz;
alter table jobs add column if not exists live_result text; -- 'open', 'closed', 'unknown'

insert into schema_migrations (name) values ('024_undated_recheck') on conflict do nothing;
