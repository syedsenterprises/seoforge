-- Run after the existing v2 schema. No user records are deleted.
begin;
-- Restrict client-owned profiles to preferences. Billing is service-role only.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id,email,plan) on public.profiles to authenticated;
grant update (weekly_summary) on public.profiles to authenticated;
drop policy if exists "own profile" on public.profiles;
create policy profile_read on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy profile_create on public.profiles for insert to authenticated with check ((select auth.uid())=id and plan='free' and email=(select auth.jwt()->>'email'));
create policy profile_preferences on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
-- Listings are personal records in the current product, not a public catalog.
drop policy if exists "listings readable" on public.listings;
revoke all on public.google_tokens from anon, authenticated;
-- Prevent a user's child records from referencing another user's parent rows.
create policy rank_parent_owner on public.rank_checks as restrictive for all to authenticated
using (exists(select 1 from public.keywords k where k.id=keyword_id and k.user_id=(select auth.uid())))
with check (exists(select 1 from public.keywords k where k.id=keyword_id and k.user_id=(select auth.uid())));
create policy order_parent_owner on public.orders as restrictive for all to authenticated
using (exists(select 1 from public.listings l where l.id=listing_id and l.user_id=(select auth.uid())))
with check (exists(select 1 from public.listings l where l.id=listing_id and l.user_id=(select auth.uid())));
create table if not exists public.billing_subscriptions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription_id text not null unique,
  status text not null,
  observed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.billing_events(
  event_id text primary key,
  subscription_id text not null,
  created_at timestamptz not null default now()
);
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.billing_subscriptions,public.billing_events from anon,authenticated;
grant all on public.billing_subscriptions,public.billing_events to service_role;
create or replace function public.apply_billing_event(p_event_id text,p_subscription_id text,p_plan text,p_status text,p_time timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare v_user uuid; v_observed timestamptz;
begin
  if p_plan not in ('free','pro','agency','business') or p_time is null then raise exception 'Invalid billing event'; end if;
  select user_id,observed_at into v_user,v_observed from public.billing_subscriptions where subscription_id=p_subscription_id for update;
  if v_user is null then raise exception 'Unknown subscription'; end if;
  insert into public.billing_events(event_id,subscription_id) values(p_event_id,p_subscription_id) on conflict do nothing;
  if not found then return; end if;
  if v_observed is not null and p_time<v_observed then return; end if;
  update public.billing_subscriptions set status=p_status,observed_at=p_time where user_id=v_user;
  update public.profiles set plan=p_plan where id=v_user;
end $$;
revoke all on function public.apply_billing_event(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_billing_event(text,text,text,text,timestamptz) to service_role;
create index if not exists rank_checks_user_keyword_date on public.rank_checks(user_id,keyword_id,checked_at desc);
create index if not exists audits_user_created on public.audits(user_id,created_at desc);
create index if not exists revenue_user_date on public.revenue_entries(user_id,entry_date desc);

-- Durable monthly usage survives deletion of visible history.
create schema if not exists seoforge_private;
revoke all on schema seoforge_private from public,anon,authenticated;
create table if not exists seoforge_private.usage(
 user_id uuid not null references auth.users(id) on delete cascade,
 month date not null, kind text not null, operation text not null,
 primary key(user_id,month,kind,operation)
);
alter table seoforge_private.usage enable row level security;
create or replace function seoforge_private.enforce_quota()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_month date := date_trunc('month',now() at time zone 'UTC')::date;
 v_limit int; v_used int; v_operation text; v_plan text;
begin
 if (select auth.uid()) is null or (select auth.uid())<>new.user_id then
   raise exception 'Authenticated owner required';
 end if;
 -- Owner (admin) account is unlimited — mirrors the client-side isAdmin()
 -- bypass. Checked by email, not plan, so the owner never counts as a
 -- paying Pro user.
 if exists (select 1 from auth.users where id=new.user_id and lower(email)='syedsinterprises@gmail.com') then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 select plan into v_plan from public.profiles where id=new.user_id;
 if tg_table_name='keywords' then
   select count(*) into v_used from public.keywords where user_id=new.user_id;
   if coalesce(v_plan,'free')<>'pro' and v_used>=10 then raise exception 'Free keyword limit reached'; end if;
   return new;
 end if;
 v_limit := case tg_table_name when 'audits' then 5 when 'verified_links' then 5 when 'content_briefs' then 3 when 'competitors' then 6 when 'site_checks' then 10 end;
 if tg_table_name='verified_links' then v_operation := new.checked_at::text; else v_operation := new.id::text; end if;
 -- The link verifier inserts all anchors from one observation at the same timestamp.
 if not exists(select 1 from seoforge_private.usage where user_id=new.user_id and month=v_month and kind=tg_table_name and operation=v_operation) then
   select count(*) into v_used from seoforge_private.usage where user_id=new.user_id and month=v_month and kind=tg_table_name;
   if coalesce(v_plan,'free')<>'pro' and v_used>=v_limit then raise exception 'Free monthly limit reached for %',tg_table_name; end if;
   insert into seoforge_private.usage values(new.user_id,v_month,tg_table_name,v_operation);
 end if;
 return new;
end $$;
revoke all on function seoforge_private.enforce_quota() from public,anon,authenticated;
do $$
declare t text;
begin
 foreach t in array array['audits','keywords','verified_links','content_briefs','competitors','site_checks'] loop
   execute format('create trigger enforce_quota before insert on public.%I for each row execute function seoforge_private.enforce_quota()',t);
 end loop;
end $$;
commit;
