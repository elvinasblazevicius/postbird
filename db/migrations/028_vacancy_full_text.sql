-- The full text of each open vacancy, kept privately for search and for reading missing details.
-- page_text: the employer's vacancy page as plain text (read by the import, src/lib/feeds/enrich.ts),
-- at most 20,000 characters. Never shown on the site. Cleared when the vacancy is no longer open.
-- search_full: what search reads it through: the page text, or the feed's description when the
-- page couldn't be read. Search uses it only for words that are rare in vacancy texts (skills,
-- tools, specialities), so common words don't bring in vacancies that merely mention them
-- (src/lib/jobs.ts, wordCondition).
alter table jobs add column if not exists page_text text;

alter table jobs add column if not exists search_full tsvector generated always as (
  to_tsvector('simple', pb_fold(left(coalesce(page_text, regexp_replace(coalesce(description_html, ''), '<[^>]+>', ' ', 'g')), 20000)))
) stored;

create index if not exists jobs_search_full_idx on jobs using gin (search_full);

-- Read the pages of open vacancies again so their text is kept (and the AI may fill what's missing).
-- Pages closed to robots stay as they are. Data only, safe to run more than once.
update jobs
   set page_checked_at = null, page_attempts = 0
 where status = 'active' and page_text is null
   and page_checked_at is not null and coalesce(page_result, '') not in ('blocked', 'skipped');
