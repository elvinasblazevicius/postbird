-- The contact form (/contact) and stories people share (/feedback?kind=testimonial) are stored
-- with the other messages. A story is shown on the site only when its author agreed to be quoted
-- (quote_ok) and an admin approved it (approved_at); withdrawing approval hides it again.
alter table feedback drop constraint if exists feedback_kind_check;
alter table feedback add constraint feedback_kind_check check (kind in ('feature', 'problem', 'other', 'contact', 'testimonial'));
alter table feedback add column if not exists display_name text;
alter table feedback add column if not exists quote_ok boolean not null default false;
alter table feedback add column if not exists approved_at timestamptz;
create index if not exists feedback_approved_idx on feedback (approved_at desc) where approved_at is not null;
