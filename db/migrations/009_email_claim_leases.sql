-- Leases for plan emails that were claimed but never sent. Safe to run more than once.
--
-- The welcome email, the confirmation link for a paid address and the
-- trial-ending reminder are "claimed" (welcome_sent_at, confirm_sent_at,
-- trial_reminder_sent_at set) before they are sent, so two runs can't both
-- send them. If the process stops between the claim and the send (the host
-- ends the function, a deploy), the claim used to stay forever and the email
-- was never sent. *_claimed_at is set with the claim and cleared once Resend
-- has answered: a claim still open after 30 minutes is picked up again by the
-- daily job (src/lib/billing/notices.ts), with the same idempotency key, so a
-- message that did go out is not sent twice within Resend's 24-hour window.
alter table subscribers add column if not exists welcome_claimed_at timestamptz;
alter table subscribers add column if not exists confirm_claimed_at timestamptz;
alter table subscribers add column if not exists trial_reminder_claimed_at timestamptz;

insert into schema_migrations (name) values ('009_email_claim_leases') on conflict do nothing;
