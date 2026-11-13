-- When the AI last read a vacancy's text for details the rules left empty (src/lib/feeds/enrich.ts).
-- Every open vacancy with a gap is read once; null = not yet.
alter table jobs add column if not exists ai_checked_at timestamptz;
