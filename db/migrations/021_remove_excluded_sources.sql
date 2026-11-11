-- Jobs from cvbankas.lt (a general Lithuanian job board, not about international organizations) that
-- arrived through the Inoreader folder before it was excluded (IMPORT_SETTINGS.excludedSourceHosts).
-- Removing them hides them everywhere and keeps future imports from bringing them back.
-- Data only, safe to run more than once.
update jobs
   set status = 'removed', removed_reason = 'Source not used on this site (cvbankas.lt)', updated_at = now()
 where status <> 'removed'
   and (apply_host = 'cvbankas.lt' or apply_host like '%.cvbankas.lt'
        or source_host = 'cvbankas.lt' or source_host like '%.cvbankas.lt');

insert into schema_migrations (name) values ('021_remove_excluded_sources') on conflict do nothing;
