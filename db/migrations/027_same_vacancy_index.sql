-- Lists and counts show only the newest copy of a vacancy posted more than once (isListed in
-- src/lib/jobs.ts looks for a newer open listing with the same title and organization). This
-- index makes that look-up quick as the number of listings grows.
create index if not exists jobs_same_vacancy_idx on jobs (lower(btrim(title)), organization_id) where status = 'active';
