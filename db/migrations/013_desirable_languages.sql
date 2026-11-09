-- Languages a vacancy calls desirable ("Knowledge of Arabic is an advantage") are kept apart from
-- the required ones: jobs.languages holds only required languages (the language filter and alerts
-- use it), jobs.desirable_languages the desirable ones (shown on the job page).
-- Safe to run more than once.
--
-- Existing listings are re-read by the next feed sync (it re-extracts every item still in its feed
-- and updates the listing when either list changed). Listings that are no longer in any feed keep
-- their old values until they close; `npm run reclassify -- --apply` re-reads those that have a
-- stored description.

alter table jobs add column if not exists desirable_languages text[];

insert into schema_migrations (name) values ('013_desirable_languages') on conflict do nothing;
