-- Run after harden-existing.sql in a disposable staging database.
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
 delete from public.audits where user_id=auth.uid();
 begin
   insert into public.audits(user_id,url) values(auth.uid(),'https://example.invalid/7');
   raise exception 'FAIL: deleting history bypassed quota';
 exception when raise_exception then
   if sqlerrm not like 'Free monthly limit reached%' then raise; end if;
 end;
end $$;
reset role;
rollback;
