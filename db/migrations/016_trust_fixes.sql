-- A trial canceled because its address wasn't confirmed in time no longer uses up the address's
-- one free trial, and Red Cross / Red Crescent emblems are never kept.
-- Safe to run more than once.

-- ── Trials canceled for want of confirmation ────────────────
-- The subscription id of a trial the daily job canceled because nobody confirmed the address
-- before it was about to end (billing flag trial_unconfirmed; src/lib/billing/subscriptions.ts,
-- runBillingSafety). While it is still the row's subscription, the row's plan fields don't count
-- as "had a plan": its owner never had that trial, even if they confirm the address later.
alter table subscribers add column if not exists unconfirmed_trial_sub text;

-- Trials canceled that way before this column existed. Their confirmation link stops working
-- (the plan it was for no longer runs), unless a sign-up of the owner's own still waits on it.
update subscribers s set
  unconfirmed_trial_sub = f.subscription_id,
  confirm_token = case when s.status <> 'confirmed' and s.pending_changes is null then null else s.confirm_token end
from billing_flags f
where f.kind = 'trial_unconfirmed' and f.cancel_done_at is not null
  and f.subscription_id = s.paddle_subscription_id
  and s.unconfirmed_trial_sub is null;

-- ── One "had a plan" rule ────────────────────────────────────
-- The same test as hadTrialBefore() in src/lib/billing/subscriptions.ts (a test checks both
-- agree): a plan while confirmed, except a trial canceled for want of confirmation.
create or replace function had_plan(s subscribers) returns boolean
language sql immutable parallel safe as $$
  select s.confirmed_at is not null
     and not coalesce(s.paddle_subscription_id = s.unconfirmed_trial_sub, false)
     and (s.paddle_subscription_id is not null or coalesce(s.billing_status, 'none') <> 'none'
          or s.trial_ends_at is not null or s.canceled_at is not null)
$$;

-- ── Red Cross and Red Crescent emblems ───────────────────────
-- Protected by the Geneva Conventions: no icon is kept for the ICRC, the IFRC or a national
-- society (the same names and websites as EMBLEM_NAME_RE / EMBLEM_DOMAIN_RE in
-- src/lib/feeds/logos.ts, which every scheduled import also clears).
update organizations set logo = null, logo_type = null
where logo is not null and (
  concat_ws(' ', name, short_name) ~* 'red ?cross|red ?crescent|red crystal|icrc|ifrc|croix[- ]?rouge|croissant[- ]?rouge|cruz roja|media luna roja|cruz vermelha|crescente vermelho|croce rossa|rote[sn]? ?kreuz|rode ?kruis|r[oøö]de ?kors|punainen risti|czerwony krzy|crveni kri|[čc]erven[ýy] k[řr]|kızılay|kizilay|magen david adom'
  or coalesce(website, '') ~* 'icrc\.org|ifrc\.org|redcross|redcrescent|croix-?rouge|cruzroja|cruzvermelha|crocerossa|rotkreuz|rodekruis|r[oø]e?dekors|drk\.de|kizilay'
);

insert into schema_migrations (name) values ('016_trust_fixes') on conflict do nothing;
