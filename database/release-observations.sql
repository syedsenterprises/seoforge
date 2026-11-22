begin;
alter table public.verified_links add column if not exists observation_id uuid;
create or replace function seoforge_private.enforce_quota()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_month date := date_trunc('month',now() at time zone 'UTC')::date;
 v_limit int; v_used int; v_operation text; v_plan text;
begin
 if (select auth.uid()) is null or (select auth.uid())<>new.user_id then
   raise exception 'Authenticated owner required';
 end if;
 new.id := gen_random_uuid();
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 select plan into v_plan from public.profiles where id=new.user_id;
 if tg_table_name='keywords' then
   select count(*) into v_used from public.keywords where user_id=new.user_id;
   if coalesce(v_plan,'free')<>'pro' and v_used>=10 then raise exception 'Free keyword limit reached'; end if;
   return new;
 end if;
 v_limit := case tg_table_name when 'audits' then 5 when 'verified_links' then 5 when 'content_briefs' then 3 when 'competitors' then 6 when 'site_checks' then 10 end;
 if tg_table_name='verified_links' then v_operation := new.observation_id::text; else v_operation := new.id::text; end if;
 -- The link verifier inserts all anchors from one observation at the same timestamp.
 if not exists(select 1 from seoforge_private.usage where user_id=new.user_id and month=v_month and kind=tg_table_name and operation=v_operation) then
   select count(*) into v_used from seoforge_private.usage where user_id=new.user_id and month=v_month and kind=tg_table_name;
   if coalesce(v_plan,'free')<>'pro' and v_used>=v_limit then raise exception 'Free monthly limit reached for %',tg_table_name; end if;
   insert into seoforge_private.usage values(new.user_id,v_month,tg_table_name,v_operation);
 end if;
 return new;
end $$;
revoke all on function seoforge_private.enforce_quota() from public,anon,authenticated;

-- Only a server-owned RPC may insert a grouped link observation.
revoke insert,update on public.verified_links from authenticated,anon;
create or replace function public.save_link_observation(p_page text,p_domain text,p_hits jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); observation uuid:=gen_random_uuid(); checked timestamptz:=clock_timestamp(); hit jsonb;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if p_page is null or p_page !~ '^https?://' or length(p_page)>4096 or p_domain is null or length(p_domain)<1 or length(p_domain)>255 then raise exception 'Invalid linking page or domain'; end if;
 if p_hits is null or jsonb_typeof(p_hits)<>'array' or jsonb_array_length(p_hits)>500 then raise exception 'A check supports at most 500 matching links'; end if;
 if jsonb_array_length(p_hits)=0 then
  insert into public.verified_links(user_id,page_url,target_domain,found,checked_at,observation_id) values(uid,p_page,p_domain,false,checked,observation);
 else
  for hit in select value from jsonb_array_elements(p_hits) loop
   if jsonb_typeof(hit)<>'object' then raise exception 'Invalid link result'; end if;
   insert into public.verified_links(user_id,page_url,target_domain,anchor,rel,found,checked_at,observation_id)
   values(uid,p_page,p_domain,left(hit->>'anchor',120),left(hit->>'rel',250),true,checked,observation);
  end loop;
 end if;
 return observation;
end $$;
revoke all on function public.save_link_observation(text,text,jsonb) from public,anon;
grant execute on function public.save_link_observation(text,text,jsonb) to authenticated;

create table if not exists public.billing_attempts(
 user_id uuid primary key references auth.users(id) on delete cascade,
 previous_subscription_id text,
 request_id uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now()
);
alter table public.billing_attempts enable row level security;
revoke all on public.billing_attempts from anon,authenticated;
grant all on public.billing_attempts to service_role;
create or replace function public.checkout_attempt(p_user uuid,p_previous text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.billing_attempts(user_id,previous_subscription_id) values(p_user,p_previous)
 on conflict(user_id) do update set
 request_id=case when public.billing_attempts.previous_subscription_id is distinct from excluded.previous_subscription_id then gen_random_uuid() else public.billing_attempts.request_id end,
 previous_subscription_id=excluded.previous_subscription_id
 returning request_id into result;
 return result;
end $$;
revoke all on function public.checkout_attempt(uuid,text) from public,anon,authenticated;
grant execute on function public.checkout_attempt(uuid,text) to service_role;
commit;
