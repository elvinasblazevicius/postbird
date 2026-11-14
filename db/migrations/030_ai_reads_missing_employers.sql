-- The AI now also fills a missing employer (only with an organization we know): open vacancies
-- without one are read again once. Data only, safe to run more than once.
update jobs set ai_checked_at = null
 where status = 'active' and organization_id is null and ai_checked_at is not null;
