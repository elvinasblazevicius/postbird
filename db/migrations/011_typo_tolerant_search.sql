-- Typo-tolerant search: when a search matches nothing, the jobs pages try
-- titles with similar words ("finanse" finds "Finance Officer") and offer
-- "Did you mean finance?". Safe to run more than once.
--
-- pb_word_similarity(a, b) and pb_similarity(a, b) use the pg_trgm extension
-- when the database has it (Supabase does), and otherwise return 0, so the
-- search simply has no typo tolerance instead of failing.

do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm extension not available (%); typo-tolerant search is off', sqlerrm;
  end;
end $$;

do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  if ext_schema is not null then
    execute format(
      'create or replace function pb_word_similarity(a text, b text) returns real language sql immutable parallel safe as %L',
      format('select %I.word_similarity(coalesce(a, %L), coalesce(b, %L))', ext_schema, '', '')
    );
    execute format(
      'create or replace function pb_similarity(a text, b text) returns real language sql immutable parallel safe as %L',
      format('select %I.similarity(coalesce(a, %L), coalesce(b, %L))', ext_schema, '', '')
    );
  else
    create or replace function pb_word_similarity(a text, b text) returns real language sql immutable parallel safe as $fn$ select 0::real $fn$;
    create or replace function pb_similarity(a text, b text) returns real language sql immutable parallel safe as $fn$ select 0::real $fn$;
  end if;
end $$;

insert into schema_migrations (name) values ('011_typo_tolerant_search') on conflict do nothing;
