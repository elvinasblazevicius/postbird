-- Accent-insensitive job search: "medecins" finds "Médecins", "cote d'ivoire"
-- finds "Côte d'Ivoire". Safe to run more than once.
--
-- pb_fold(text) is the text in lower case without accents. It uses the
-- unaccent extension when the database has it (Supabase does), and otherwise a
-- built-in fallback for the common Latin letters, so the search works either way.
-- search_folded is a folded copy of search_vector; the job search uses it.

do $$
begin
  begin
    create extension if not exists unaccent;
  exception when others then
    raise notice 'unaccent extension not available (%); pb_fold uses the built-in fallback', sqlerrm;
  end;
end $$;

do $$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'unaccent';
  if ext_schema is not null then
    -- unaccent() itself is only "stable"; naming the dictionary makes this wrapper safe to mark immutable.
    execute format(
      'create or replace function pb_fold(t text) returns text language sql immutable parallel safe as %L',
      format('select lower(%I.unaccent(%L::regdictionary, coalesce(t, %L)))', ext_schema, ext_schema || '.unaccent', '')
    );
  else
    execute $fn$
      create or replace function pb_fold(t text) returns text language sql immutable parallel safe as $body$
        select replace(replace(replace(replace(
          translate(lower(coalesce(t, '')),
            'àáâãäåāăąçćčďđèéêëēěęìíîïīıłñńňòóôõöøōőŕřśšşťùúûüūůűýÿźżžğ',
            'aaaaaaaaacccddeeeeeeeiiiiiilnnnoooooooorrssstuuuuuuuyyzzzg'),
          'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'), 'þ', 'th')
      $body$
    $fn$;
  end if;
end $$;

alter table jobs add column if not exists search_folded tsvector generated always as (
  setweight(to_tsvector('simple', pb_fold(title)), 'A') ||
  setweight(to_tsvector('simple', pb_fold(coalesce(location_text, '') || ' ' || coalesce(city, '') || ' ' || coalesce(grade, '') || ' ' || coalesce(job_type, ''))), 'B') ||
  setweight(to_tsvector('simple', pb_fold(summary)), 'C')
) stored;

create index if not exists jobs_search_folded_idx on jobs using gin (search_folded);

insert into schema_migrations (name) values ('007_accent_insensitive_search') on conflict do nothing;
