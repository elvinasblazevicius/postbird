-- A new vacancy from the import is held back (held = true) until the import has tried to fill in
-- what its feed left out (place, closing date: the employer's page and the AI), so a card never
-- appears half-filled; see markListed in src/lib/feeds/sync.ts. listed_at is when it was shown:
-- alerts and the weekly email pick vacancies up by coalesce(listed_at, first_seen_at), so a held
-- vacancy is still sent once shown. Rows added any other way are shown at once (held defaults to false).
alter table jobs add column if not exists held boolean not null default false;
alter table jobs add column if not exists listed_at timestamptz;
create index if not exists jobs_held_idx on jobs (id) where held;
