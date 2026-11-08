-- Jobs keep the host of the feed item's own link separately from the
-- application link, which is always the employer's own page.
alter table jobs add column if not exists source_host text;
update jobs set source_host = apply_host where source_host is null;

-- Organization website and its small icon (fetched server-side at sync time,
-- served from /api/org-logo/<slug>, so visitors never contact a third party).
alter table organizations add column if not exists website text;
alter table organizations add column if not exists logo bytea;
alter table organizations add column if not exists logo_type text;
alter table organizations add column if not exists logo_checked_at timestamptz;
