-- The continue page's button holds its emailed checkout link while the checkout is prepared,
-- and only uses the link up once that worked. Additive only. Safe to run more than once.

-- ── Checkout link claims ────────────────────────────────────
-- continueCheckout (src/lib/billing/checkout-links.ts) first claims the link (a random claim
-- token and the time), then prepares the checkout (for a returning customer, a Paddle
-- transaction), and only then sets used_at, together with the checkout record, under its own
-- claim. A second press while the first is still at work (a double click) finds the link claimed
-- and prepares nothing; a press whose request died leaves a claim that lapses after 30 seconds,
-- so the link still works. Code from before this migration ignores both columns.
alter table checkout_links add column if not exists claim text;
alter table checkout_links add column if not exists claimed_at timestamptz;

insert into schema_migrations (name) values ('018_checkout_link_claims') on conflict do nothing;
