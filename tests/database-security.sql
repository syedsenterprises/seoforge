-- Transactional release verification; fixtures are rolled back.
begin;

-- All fixture writes and schema changes in this verification are rolled back.
select set_config('seoforge.test_a',gen_random_uuid()::text,true);
select set_config('seoforge.test_b',gen_random_uuid()::text,true);
insert into auth.users(id,email) values
(current_setting('seoforge.test_a')::uuid,'seoforge-test-a@example.invalid'),
(current_setting('seoforge.test_b')::uuid,'seoforge-test-b@example.invalid');
select set_config('request.jwt.claims',json_build_object('sub',current_setting('seoforge.test_b'),'email','seoforge-test-b@example.invalid','role','authenticated')::text,true);
set local role authenticated;
insert into public.profiles(id,email,plan) values(auth.uid(),'seoforge-test-b@example.invalid','free');
insert into public.keywords(user_id,keyword,url) values(auth.uid(),'private','https://example.invalid');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('seoforge.test_a'),'email','seoforge-test-a@example.invalid','role','authenticated')::text,true);
set local role authenticated;
insert into public.profiles(id,email,plan) values(auth.uid(),'seoforge-test-a@example.invalid','free');
do $$
declare i int;
begin
 if exists(select 1 from public.keywords) then raise exception 'FAIL: another user keyword visible'; end if;
 begin
   update public.profiles set plan='pro' where id=auth.uid();
   raise exception 'FAIL: client changed billing plan';
 exception when insufficient_privilege then null;
 end;
 update public.profiles set weekly_summary=true where id=auth.uid();
 if not (select weekly_summary from public.profiles where id=auth.uid()) then raise exception 'FAIL: preference update'; end if;
 for i in 1..5 loop
   insert into public.audits(user_id,url) values(auth.uid(),'https://example.invalid/'||i);
 end loop;
 begin
   insert into public.audits(user_id,url) values(auth.uid(),'https://example.invalid/6');
   raise exception 'FAIL: quota not enforced';
 exception when raise_exception then
   if sqlerrm not like 'Free monthly limit reached%' then raise; end if;
 end;
 if (public.current_usage()->>'auditsUsed')::int<>5 then raise exception 'FAIL: authoritative usage'; end if;
 delete from public.audits where user_id=auth.uid();
 begin
   insert into public.audits(user_id,url) values(auth.uid(),'https://example.invalid/7');
   raise exception 'FAIL: deleting history bypassed quota';
 exception when raise_exception then
   if sqlerrm not like 'Free monthly limit reached%' then raise; end if;
 end;
end $$;

do $$
declare i int; saved uuid;
begin
 -- A caller cannot bypass link accounting through the raw table.
 begin
  insert into public.verified_links(user_id,page_url,target_domain,checked_at) values(auth.uid(),'https://example.invalid','target.invalid',now());
  raise exception 'FAIL: direct link inserts allowed';
 exception when insufficient_privilege then null;
 end;
 for i in 1..5 loop
  saved:=public.save_link_observation('https://example.invalid/'||i,'target.invalid','[{"anchor":"a","rel":""},{"anchor":"b","rel":"nofollow"}]'::jsonb);
 end loop;
 if (public.current_usage()->>'linksUsed')::int<>5 then raise exception 'FAIL: anchors counted as separate observations'; end if;
 begin
  perform public.save_link_observation('https://example.invalid/6','target.invalid','[]'::jsonb);
  raise exception 'FAIL: link quota bypassed';
 exception when raise_exception then
  if sqlerrm not like 'Free monthly limit reached%' then raise; end if;
 end;
 begin
  insert into public.audits(id,user_id,url) values(gen_random_uuid(),auth.uid(),'https://example.invalid/replay');
  raise exception 'FAIL: client supplied ID bypassed quota';
 exception when raise_exception then
  if sqlerrm not like 'Free monthly limit reached%' then raise; end if;
 end;
end $$;
reset role;
set local role service_role;
do $$
declare i int; allowed boolean;
begin
 for i in 1..11 loop
  allowed:=public.claim_api_request(current_setting('seoforge.test_a')::uuid,'billing',10);
  if allowed<>(i<=10) then raise exception 'FAIL: API rate limit'; end if;
 end loop;
end $$;

do $$
declare first_id uuid; retry_id uuid; replacement_id uuid; uid uuid:=current_setting('seoforge.test_a')::uuid;
begin
 first_id:=public.checkout_attempt(uid,null);
 retry_id:=public.checkout_attempt(uid,null);
 replacement_id:=public.checkout_attempt(uid,'I-TERMINAL');
 if first_id<>retry_id or first_id=replacement_id then raise exception 'FAIL: checkout idempotency lifecycle'; end if;
end $$;
reset role;
rollback;
