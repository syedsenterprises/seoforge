begin;
create or replace function public.current_usage()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid := auth.uid(); m date:=date_trunc('month',now() at time zone 'UTC')::date; result jsonb;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 select jsonb_build_object(
 'auditsUsed',count(*) filter(where kind='audits'),
 'linksUsed',count(*) filter(where kind='verified_links'),
 'briefsUsed',count(*) filter(where kind='content_briefs'),
 'comparesUsed',(select count(*) from public.site_checks where user_id=uid and check_type='compare' and date_trunc('month', created_at at time zone 'UTC')::date=m),
 'toolChecksUsed',count(*) filter(where kind='site_checks'),
 'keywordsUsed',(select count(*) from public.keywords where user_id=uid))
 into result from seoforge_private.usage where user_id=uid and month=m;
 return result;
end $$;
revoke all on function public.current_usage() from public,anon;
grant execute on function public.current_usage() to authenticated;

create table if not exists public.api_rate_limits(
 user_id uuid not null references auth.users(id) on delete cascade,
 action text not null, window_start timestamptz not null, requests int not null,
 primary key(user_id,action)
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon,authenticated;
grant all on public.api_rate_limits to service_role;
create or replace function public.claim_api_request(p_user uuid,p_action text,p_limit int)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n int; w timestamptz:=date_trunc('minute',now());
begin
 insert into public.api_rate_limits values(p_user,p_action,w,1)
 on conflict(user_id,action) do update set
 requests=case when public.api_rate_limits.window_start=excluded.window_start then public.api_rate_limits.requests+1 else 1 end,
 window_start=excluded.window_start returning requests into n;
 return n<=p_limit;
end $$;
revoke all on function public.claim_api_request(uuid,text,int) from public,anon,authenticated;
grant execute on function public.claim_api_request(uuid,text,int) to service_role;
commit;

