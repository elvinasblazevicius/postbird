-- Feature requests and other messages sent from /feedback. Kept until deleted by hand; the
-- privacy policy says what is stored (the message, the optional email address, the page it came from).
create table if not exists feedback (
  id bigserial primary key,
  kind text not null check (kind in ('feature', 'problem', 'other')),
  message text not null,
  email text,
  page text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback (created_at desc);
-- The site reads and writes it from the server only; no public API access (as every table).
alter table feedback enable row level security;
