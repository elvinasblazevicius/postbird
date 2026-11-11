-- Jobs that link to eurobrussels.com (a job board, which the site never links to) and two that link
-- to pluxee.de (an employee-benefits company named in the job text, not the employer's vacancy).
-- From now on the import treats eurobrussels.com as a board (src/lib/feeds/url.ts). Removing hides
-- them everywhere and keeps future imports from bringing them back. Data only, safe to run again.
update jobs
   set status = 'removed', removed_reason = 'Links to a job board or a site other than the employer', updated_at = now()
 where status <> 'removed'
   and (apply_host in ('eurobrussels.com', 'pluxee.de') or apply_host like '%.eurobrussels.com' or apply_host like '%.pluxee.de');

insert into schema_migrations (name) values ('022_remove_more_board_links') on conflict do nothing;
