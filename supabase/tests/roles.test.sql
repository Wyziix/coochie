-- Role rules: users can't change their role, only admins can run admin functions.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('aaaaaaaa-0000-0000-0000-000000000001', 'user@test.dev');
select pg_temp.new_user('aaaaaaaa-0000-0000-0000-000000000002', 'kopenkin.ne@gmail.com');

select pg_temp.check((select role = 'user' from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'new profiles default to role user');

-- Seeding an admin works by email (same statement the migration uses).
update public.profiles p set role = 'admin' from auth.users u
where u.id = p.id and lower(u.email) = 'kopenkin.ne@gmail.com';
select pg_temp.check((select role = 'admin' from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'admin seeded by email');

-- A normal user.
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check(not public.is_admin(), 'is_admin() is false for a user');
select pg_temp.expect_error($$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'user cannot promote themselves');
select pg_temp.expect_error($$update public.profiles set role = 'admin', display_name = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'user cannot promote themselves alongside other changes');
-- Same check with the backup trigger off: RLS alone must block it.
select pg_temp.logout();
alter table public.profiles disable trigger profiles_protect_role;
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error($$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'RLS alone blocks self-promotion');
select pg_temp.logout();
alter table public.profiles enable trigger profiles_protect_role;
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000001');
update public.profiles set display_name = 'Still fine' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.check((select display_name = 'Still fine' and role = 'user' from public.profiles),
  'user can still edit other profile fields');
select pg_temp.expect_error(
  $$select public.admin_save_exercise(null, 'Fake Exercise', 'chest', '{}', 'barbell', 'weights', null, 90)$$,
  'user cannot create global exercises');
select pg_temp.expect_error(
  $$select public.admin_set_exercise_hidden((select id from public.exercises where slug = 'deadlift'), true)$$,
  'user cannot hide global exercises');
select pg_temp.expect_error($$select public.log_admin_action('x')$$, 'user cannot call log_admin_action directly');
select pg_temp.expect_error($$insert into public.admin_actions (action) values ('fake')$$, 'user cannot write the admin log');
select pg_temp.check((select count(*) from public.admin_actions) = 0, 'user cannot read the admin log');
with u as (update public.exercises set name = 'Hacked' where slug = 'deadlift' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'direct update of a global exercise changes nothing');
select pg_temp.expect_error($$insert into public.exercises (name, primary_muscle, equipment, type) values ('Sneaky Global', 'chest', 'barbell', 'weights')$$,
  'user cannot insert a global exercise');
select pg_temp.logout();

select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.custom_access_token_hook('{"user_id":"aaaaaaaa-0000-0000-0000-000000000001"}'::jsonb)$$,
  'authenticated cannot call the access token hook');
select pg_temp.logout();

-- The admin.
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.check(public.is_admin(), 'is_admin() is true for the admin');
select pg_temp.check(
  (select (public.admin_save_exercise(null, 'Zercher Squat', 'quads', '{glutes}', 'barbell', 'weights', 'Bar in elbows.', 150)).name = 'Zercher Squat'),
  'admin can create a global exercise');
select pg_temp.check(
  (select (public.admin_set_exercise_hidden((select id from public.exercises where name = 'Zercher Squat'), true)).is_hidden),
  'admin can hide a global exercise');
select pg_temp.check(
  (select (public.admin_save_exercise((select id from public.exercises where name = 'Zercher Squat'), 'Zercher Squat (Barbell)', 'quads', '{glutes,abs}', 'barbell', 'weights', null, 120)).default_rest_seconds = 120),
  'admin can edit a global exercise');
select pg_temp.check(
  (select array_agg(action order by id) = array['exercise.create', 'exercise.hide', 'exercise.update']
     and bool_and(admin_id = 'aaaaaaaa-0000-0000-0000-000000000002' and target_id is not null)
   from public.admin_actions),
  'every admin action is logged with admin id and target');
select pg_temp.expect_error($$update public.profiles set role = 'user' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  'even an admin cannot change roles from the app');
-- The app saves profiles with an upsert (PostgREST on_conflict); it must still work for admins.
insert into public.profiles (id, display_name) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Boss')
on conflict (id) do update set display_name = excluded.display_name;
select pg_temp.check((select display_name = 'Boss' and role = 'admin' from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'admin can still save their profile via upsert, and stays admin');
select pg_temp.expect_error(
  $$insert into public.profiles (id, role) values ('aaaaaaaa-0000-0000-0000-000000000002', 'admin')
    on conflict (id) do update set role = excluded.role$$,
  'upsert cannot be used to set a role');
select pg_temp.logout();

-- Service role / SQL can change roles.
set local role service_role;
update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
select pg_temp.check((select role = 'admin' from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'service role can change roles');
update public.profiles set role = 'user' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Access token hook adds the role claim.
set local role supabase_auth_admin;
select pg_temp.check(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'aaaaaaaa-0000-0000-0000-000000000002', 'claims', '{"sub":"x","role":"authenticated"}'::jsonb
   )) -> 'claims' ->> 'user_role') = 'admin',
  'token hook adds user_role=admin for the admin');
select pg_temp.check(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'claims', '{"sub":"x","role":"authenticated"}'::jsonb
   )) -> 'claims' ->> 'user_role') = 'user',
  'token hook adds user_role=user for a user');
select pg_temp.check(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'claims', '{"sub":"x","role":"authenticated"}'::jsonb
   )) -> 'claims' ->> 'role') = 'authenticated',
  'token hook keeps existing claims');
reset role;

-- Demotion takes effect immediately (is_admin reads the table, not the JWT).
update public.profiles set role = 'user' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select pg_temp.login('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.check(not public.is_admin(), 'demoted admin loses admin rights at once');
select pg_temp.logout();

rollback;
\echo 'roles tests passed'
