-- Facts read from the employer's own vacancy page (src/lib/feeds/vacancy-page.ts), kept apart from
-- what the feed said so a later re-import never wipes them: the import uses a page fact only where
-- the feed has none. Facts only (dates, place, contract, grade, experience, languages), never text.
alter table jobs add column if not exists page_checked_at timestamptz;
alter table jobs add column if not exists page_attempts int not null default 0;
-- 'ok' (facts found), 'none' (page read, nothing usable), 'blocked' (robots.txt), 'error' (fetch failed), 'skipped' (not an HTML page, e.g. a PDF)
alter table jobs add column if not exists page_result text;
alter table jobs add column if not exists page_deadline date;
alter table jobs add column if not exists page_country_code text;
alter table jobs add column if not exists page_city text;
alter table jobs add column if not exists page_location_text text;
alter table jobs add column if not exists page_job_type text;
alter table jobs add column if not exists page_grade text;
alter table jobs add column if not exists page_experience_years int;
alter table jobs add column if not exists page_languages text[];

-- The import picks open jobs whose page hasn't been read yet (or is due a retry).
create index if not exists jobs_page_due_idx on jobs (page_checked_at nulls first) where status = 'active';

-- Employer links found behind a job board's "Apply on the employer's website" link
-- (src/lib/feeds/board-links.ts), so each listing is looked up once. target_url null: none found.
create table if not exists board_links (
  source_url text primary key,
  target_url text,
  checked_at timestamptz not null default now()
);

insert into schema_migrations (name) values ('023_vacancy_page_facts') on conflict do nothing;
