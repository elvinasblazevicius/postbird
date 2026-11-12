-- The vacancy-page reader now (1) takes a closing date the page labels as such ("Closing at:",
-- "Application deadline …", also outside the main text) before a JobPosting record's "valid
-- through", and (2) no longer believes a "valid through" more than 75 days ahead: recruitment
-- systems fill it with their own expiry (90 days, a year), not the closing date.
-- So: take back closing dates that came from such a record, and read again the pages of open
-- jobs that still have no closing date. Data only, safe to run more than once.
update jobs
   set deadline = null, page_deadline = null, page_checked_at = null, page_attempts = 0, updated_at = now()
 where status = 'active'
   and page_deadline is not null and deadline = page_deadline
   and page_deadline > (now() at time zone 'utc')::date + 75;

-- The same for systems seen to do this (UNICEF's PageUp gives "valid through" 90 days after
-- posting; iCIMS and softgarden a year or two): any closing date of theirs that came from the page
-- is read again, so the page's own "Closing at: …" replaces it.
update jobs
   set deadline = null, page_deadline = null, page_checked_at = null, page_attempts = 0, updated_at = now()
 where status = 'active'
   and page_deadline is not null and deadline = page_deadline
   and apply_host ~* '(^|\.)(jobs\.unicef\.org|pageuppeople\.com|icims\.com|softgarden\.io)$';

update jobs
   set page_checked_at = null, page_attempts = 0
 where status = 'active' and deadline is null
   and page_checked_at is not null and coalesce(page_result, '') <> 'blocked';

-- Jobs whose application link is a job board's page (imported in the minutes between a board being
-- recognised and the earlier clean-up): the site never links to a board. The import now also
-- checks this after every run (src/lib/feeds/sync.ts).
update jobs
   set status = 'removed', removed_reason = 'Links to a job board, not the employer', updated_at = now()
 where status <> 'removed'
   and apply_host ~* '(^|\.)(reliefweb\.int|unjobs\.org|impactpool\.org|devex\.com|unjobnet\.org|idealist\.org|unvacancies\.org|untalent\.org|eurobrussels\.com)$';

insert into schema_migrations (name) values ('025_reread_vacancy_pages') on conflict do nothing;
