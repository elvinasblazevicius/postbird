-- The trial form's "renews automatically" checkbox, recorded on the server. Additive only.
-- Safe to run more than once.

-- ── Agreement to automatic renewal ──────────────────────────
-- startCheckoutAction and continueCheckoutAction (src/app/billing-actions.ts) refuse a checkout
-- unless the box was ticked, and the checkout record keeps when (renewal_consent_at) and which
-- wording was agreed to (renewal_terms_version: a short hash of the checkbox and terms text,
-- src/lib/billing/renewal-consent.ts). A checkout that led to a subscription keeps these two with
-- the subscriber's records (the daily clean-up removes its visitor code and search after 30 days
-- and deletes the row with the subscriber); other checkouts are deleted after 30 days as before.
-- Null for checkouts prepared before this column existed. Code from before ignores both columns.
alter table paddle_checkouts add column if not exists renewal_consent_at timestamptz;
alter table paddle_checkouts add column if not exists renewal_terms_version text;

insert into schema_migrations (name) values ('019_renewal_consent') on conflict do nothing;
