-- A plan (trial, active, payment overdue or paused) now allows 20 saved searches instead of 5
-- (MAX_SAVED_SEARCHES in src/lib/saved-searches.ts). Free subscribers keep one, as before. The
-- daily email still lists at most 50 vacancies in all, shared evenly between the searches, so it
-- stays under the size at which mail apps cut a message off (capGroups in src/lib/email-templates.ts).
create or replace function saved_searches_limit() returns trigger language plpgsql as $$
declare
  lim int;
begin
  select case when billing_status in ('trialing', 'active', 'past_due', 'paused') then 20 else 1 end into lim
  from subscribers where id = new.subscriber_id for update;
  if (select count(*) from saved_searches where subscriber_id = new.subscriber_id) >= coalesce(lim, 1) then
    raise exception 'saved search limit reached' using errcode = 'P0001',
      hint = case when coalesce(lim, 1) = 1 then 'saved_searches_free_limit' else 'saved_searches_limit' end;
  end if;
  return new;
end $$;

insert into schema_migrations (name) values ('026_twenty_saved_searches') on conflict do nothing;
