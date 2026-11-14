-- The last events the server sent to Meta's Conversions API and Meta's answer, for Admin → Overview
-- ("Meta" card): event name, accepted or not, and Meta's error when refused. No personal data
-- (no email, IP address or click id is stored here). Only the newest 200 rows are kept.
create table if not exists meta_capi_log (
  id bigserial primary key,
  event text not null,
  ok boolean not null,
  detail text,
  at timestamptz not null default now()
);
alter table meta_capi_log enable row level security;
