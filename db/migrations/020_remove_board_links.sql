-- Jobs imported before untalent.org was recognised as a job board link to the board instead of
-- the employer (the site must never link to a board). Removing them hides them everywhere and keeps
-- future imports from bringing the same listing back; from now on the import reads the employer's
-- own link from such items or skips them (src/lib/feeds/url.ts). Data only, safe to run more than once.
update jobs
   set status = 'removed', removed_reason = 'Links to a job board (untalent.org), not the employer', updated_at = now()
 where status <> 'removed'
   and (apply_host = 'untalent.org' or apply_host like '%.untalent.org');

insert into schema_migrations (name) values ('020_remove_board_links') on conflict do nothing;
