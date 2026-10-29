-- RLS and constraint tests for profiles. Runs inside one transaction and
-- rolls back. Uses only plain SQL so it also works against a Supabase branch.
\set ON_ERROR_STOP on
begin;

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.expect_error(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (statement succeeded but should have failed)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: % (%)', label, sqlerrm;
end $$;

create function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '{"full_name":"Alice A","avatar_url":"https://img/a.png"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '{"name":"Bob B","picture":"https://img/b.png"}');

select pg_temp.check(
  (select display_name = 'Alice A' and avatar_url = 'https://img/a.png' from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'trigger creates profile from Google full_name/avatar_url');
select pg_temp.check(
  (select display_name = 'Bob B' and avatar_url = 'https://img/b.png' from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'trigger falls back to name/picture');

-- Anonymous users see nothing.
set local role anon;
select pg_temp.check((select count(*) from public.profiles) = 0, 'anon cannot read profiles');
select pg_temp.expect_error($$select public.is_username_available('x')$$, 'anon cannot call is_username_available');
reset role;

-- Bob picks a username.
select pg_temp.login('22222222-2222-2222-2222-222222222222');
update public.profiles set username = 'bob' where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.logout();

select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.check((select count(*) from public.profiles) = 1, 'user only sees own profile');
select pg_temp.check((select id from public.profiles) = '11111111-1111-1111-1111-111111111111', 'the visible profile is mine');

with u as (update public.profiles set display_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'cannot update someone else''s profile');

select pg_temp.expect_error(
  $$insert into public.profiles (id) values ('33333333-3333-3333-3333-333333333333')$$,
  'cannot insert a profile for another id');
select pg_temp.expect_error(
  $$update public.profiles set id = '22222222-2222-2222-2222-222222222222' where id = '11111111-1111-1111-1111-111111111111'$$,
  'cannot move own row to another id');

select pg_temp.check(public.is_username_available('alice'), 'free username is available');
select pg_temp.check(not public.is_username_available('bob'), 'taken username is not available');
select pg_temp.check(not public.is_username_available('BOB'), 'availability check is case-insensitive');

select pg_temp.expect_error($$update public.profiles set username = 'bob'$$, 'duplicate username rejected');
select pg_temp.expect_error($$update public.profiles set username = 'Alice'$$, 'uppercase username rejected');
select pg_temp.expect_error($$update public.profiles set username = 'al'$$, 'too short username rejected');
select pg_temp.expect_error($$update public.profiles set username = 'al ice'$$, 'username with space rejected');
select pg_temp.expect_error($$update public.profiles set training_days_per_week = 8$$, 'training days > 7 rejected');
select pg_temp.expect_error($$update public.profiles set bodyweight_kg = 5$$, 'unrealistic bodyweight rejected');
select pg_temp.expect_error($$update public.profiles set onboarding_completed_at = now()$$,
  'cannot complete onboarding without required answers');

update public.profiles set updated_at = '2000-01-01' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set
  username = 'alice', units = 'lbs', goal = 'strength', experience_level = 'beginner',
  training_days_per_week = 3, bodyweight_kg = 80.5, onboarding_completed_at = now()
where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.check((select onboarding_completed_at is not null and updated_at > '2001-01-01' from public.profiles),
  'onboarding completes and updated_at is refreshed');
select pg_temp.check(public.is_username_available('alice'), 'own username counts as available to me');

-- Storage: only inside own folder.
insert into storage.objects (bucket_id, name) values ('avatars', '11111111-1111-1111-1111-111111111111/avatar.jpg');
select pg_temp.check(true, 'can upload avatar into own folder');
select pg_temp.expect_error(
  $$insert into storage.objects (bucket_id, name) values ('avatars', '22222222-2222-2222-2222-222222222222/avatar.jpg')$$,
  'cannot upload into another user''s folder');
select pg_temp.expect_error(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'avatar.jpg')$$,
  'cannot upload outside a user folder');
select pg_temp.logout();

-- Deleting the auth user removes the profile.
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.check(not exists (select 1 from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'profile is deleted with the auth user');

rollback;
\echo 'profiles tests passed'
