-- Templates, ready-made programs, admin template functions, and server-only
-- workout writes (edit / delete recalculate on the server).
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('dddddddd-0000-0000-0000-000000000001', 'u1@test.dev');
select pg_temp.new_user('dddddddd-0000-0000-0000-000000000002', 'u2@test.dev');
select pg_temp.new_user('dddddddd-0000-0000-0000-000000000009', 'admin@test.dev');
update public.profiles set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000009';

select pg_temp.check((select count(*) = 8 from public.templates where owner_id is null), '8 ready-made templates seeded');
select pg_temp.check((select count(distinct program) = 4 from public.templates where owner_id is null),
  'PPL, Upper/Lower, Full Body and 5x5 programs');
select pg_temp.check(
  (select bool_and(n > 0) from (select count(te.*) n from public.templates t left join public.template_exercises te on te.template_id = t.id where t.owner_id is null group by t.id) x),
  'every ready-made template has exercises');

-- User 1 builds a template.
select pg_temp.login('dddddddd-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 8 from public.templates), 'users see the ready-made templates');

create temp table t1 as
select * from public.save_template(null, '{"name":" My Push ","program":"Sneaky","position":99}',
  jsonb_build_array(
    jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'target_sets', 4, 'target_reps_min', 5, 'target_reps_max', 8),
    jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'plank'), 'target_sets', 2, 'target_duration_seconds', 60)
  ));
select pg_temp.check((select name = 'My Push' and program is null and owner_id = 'dddddddd-0000-0000-0000-000000000001' from t1),
  'save_template creates an own template (name trimmed, program ignored)');
select pg_temp.check((select count(*) = 1 from public.templates where owner_id = 'dddddddd-0000-0000-0000-000000000001'), 'exactly one template created');
select pg_temp.check((select array_agg(position order by position) = '{0,1}' from public.template_exercises where template_id = (select id from t1)),
  'exercise order kept');

select public.save_template((select id from t1), '{"name":"My Push v2"}',
  jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'overhead_press'), 'target_sets', 3, 'target_reps_min', 8)));
select pg_temp.check((select count(*) = 1 from public.template_exercises where template_id = (select id from t1)), 'editing replaces the exercise list');

select pg_temp.expect_error($$select public.save_template(null, '{"name":"Empty"}', '[]')$$, 'template needs at least one exercise');
select pg_temp.expect_error($$select public.save_template(null, '{"name":"Bad"}', jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'deadlift'), 'target_sets', 50)))$$,
  'unrealistic target sets rejected');
select pg_temp.expect_error($$select public.save_template(null, '{"name":"Bad"}', jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'deadlift'), 'target_reps_min', 12, 'target_reps_max', 8)))$$,
  'rep range must be min <= max');
select pg_temp.expect_error($$select public.save_template((select id from public.templates where owner_id is null limit 1), '{"name":"Hijack"}', jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'deadlift'))))$$,
  'user cannot edit a ready-made template');
select pg_temp.expect_error($$insert into public.templates (owner_id, name) values ('dddddddd-0000-0000-0000-000000000001', 'direct')$$,
  'templates cannot be inserted directly');
select pg_temp.expect_error($$select public.admin_save_template(null, '{"name":"Fake"}', jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'deadlift'))))$$,
  'non-admin cannot create ready-made templates');
select pg_temp.expect_error($$select public.admin_set_template_hidden((select id from public.templates where owner_id is null limit 1), true)$$,
  'non-admin cannot hide ready-made templates');
select pg_temp.expect_error($$select public.admin_delete_template((select id from public.templates where owner_id is null limit 1))$$,
  'non-admin cannot delete ready-made templates');
with d as (delete from public.templates where owner_id is null returning 1)
select pg_temp.check((select count(*) = 0 from d), 'user cannot delete ready-made templates directly');

-- A custom exercise of user 2 can't be put in user 1's template.
select pg_temp.logout();
insert into public.exercises (id, name, primary_muscle, equipment, type, owner_id)
values ('eeeeeeee-0000-0000-0000-000000000002', 'U2 Secret Move', 'chest', 'band', 'weights', 'dddddddd-0000-0000-0000-000000000002');
select pg_temp.login('dddddddd-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.save_template(null, '{"name":"Steal"}', '[{"exercise_id":"eeeeeeee-0000-0000-0000-000000000002"}]')$$,
  'cannot use another user''s custom exercise in a template');

-- Workouts: save, edit (server recalculates), save as template, delete.
select public.save_workout(
  jsonb_build_object('id', 'ffffffff-0000-0000-0000-000000000001', 'name', 'Push', 'started_at', '2026-10-01T10:00:00Z', 'ended_at', '2026-10-01T11:00:00Z', 'template_id', (select id from t1)),
  jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 0, 'set_type', 'warmup', 'weight_kg', 40, 'reps', 10),
    jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 1, 'weight_kg', 80, 'reps', 5),
    jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 2, 'weight_kg', 80, 'reps', 8),
    jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'plank'), 'exercise_order', 1, 'set_order', 0, 'duration_seconds', 60)
  ));
select pg_temp.check((select template_id = (select id from t1) and total_volume_kg = 1040 from public.workouts), 'workout records its template');

-- Direct writes are blocked: totals can only come from the server.
with u as (update public.workouts set total_volume_kg = 999999 returning 1)
select pg_temp.check((select count(*) = 0 from u), 'client cannot overwrite workout volume directly');
select pg_temp.check((select total_volume_kg = 1040 from public.workouts), 'volume unchanged after direct update attempt');
with d as (delete from public.workouts returning 1)
select pg_temp.check((select count(*) = 0 from d), 'client cannot delete workouts directly');
with d as (delete from public.workout_sets returning 1)
select pg_temp.check((select count(*) = 0 from d), 'client cannot delete sets directly');
select pg_temp.expect_error($$insert into public.workouts (id, name, started_at, ended_at, duration_seconds, total_volume_kg) values (gen_random_uuid(), 'fake', now(), now(), 0, 5000)$$,
  'client cannot insert workouts with made-up totals');

-- Edit: new date, longer, a set changed. Duration and volume recomputed.
select public.save_workout(
  jsonb_build_object('id', 'ffffffff-0000-0000-0000-000000000001', 'name', 'Push (edited)', 'started_at', '2026-09-30T18:00:00Z', 'ended_at', '2026-09-30T19:30:00Z',
                     'total_volume_kg', 1, 'duration_seconds', 1),
  jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 100, 'reps', 5)
  ));
select pg_temp.check((select name = 'Push (edited)' and duration_seconds = 5400 and total_volume_kg = 500 and started_at = '2026-09-30T18:00:00Z' from public.workouts),
  'editing recomputes duration and volume on the server, ignoring client totals');
select pg_temp.check((select template_id = (select id from t1) from public.workouts), 'editing keeps the template link');
select pg_temp.check((select count(*) = 1 from public.workout_sets), 'edited sets replace the old ones');
select pg_temp.expect_error(
  $$select public.save_workout(jsonb_build_object('id', 'ffffffff-0000-0000-0000-000000000009', 'name', 'Future', 'started_at', now() + interval '3 days', 'ended_at', now() + interval '3 days 1 hour'),
     jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'deadlift'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 100, 'reps', 5)))$$,
  'cannot date a workout in the future');
select pg_temp.expect_error(
  $$select public.save_workout(jsonb_build_object('id', gen_random_uuid(), 'name', 'Steal', 'started_at', now(), 'ended_at', now()),
     '[{"id":"aaaaaaaa-1111-0000-0000-000000000000","exercise_id":"eeeeeeee-0000-0000-0000-000000000002","exercise_order":0,"set_order":0,"reps":5}]')$$,
  'cannot log another user''s custom exercise');

create temp table t2 as select * from public.template_from_workout('ffffffff-0000-0000-0000-000000000001', 'From workout');
select pg_temp.check((select name = 'From workout' and owner_id = 'dddddddd-0000-0000-0000-000000000001' from t2), 'save workout as template');
select pg_temp.check((select target_sets = 1 and target_reps_min = 5 and target_reps_max is null from public.template_exercises where template_id = (select id from t2)),
  'template copies working sets and reps');
select pg_temp.logout();

-- User 2 can't see or touch user 1's things.
select pg_temp.login('dddddddd-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) = 8 from public.templates), 'other users only see ready-made templates');
select pg_temp.expect_error($$select public.template_from_workout('ffffffff-0000-0000-0000-000000000001', 'x')$$, 'cannot copy someone else''s workout');
select pg_temp.expect_error($$select public.delete_workout('ffffffff-0000-0000-0000-000000000001')$$, 'cannot delete someone else''s workout');
select pg_temp.expect_error($$select public.save_template((select id from t1), '{"name":"x"}', jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'deadlift'))))$$,
  'cannot edit someone else''s template');
select pg_temp.logout();

-- User 1 deletes the workout; the template survives, the link would be nulled.
select pg_temp.login('dddddddd-0000-0000-0000-000000000001');
select public.delete_workout('ffffffff-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 0 from public.workouts) and (select count(*) = 0 from public.workout_sets), 'delete_workout removes workout and sets');
delete from public.templates where id = (select id from t2);
select pg_temp.check((select count(*) = 0 from public.templates where id = (select id from t2)), 'user can delete own template');
select pg_temp.logout();

-- Admin manages ready-made templates; everything is logged.
select pg_temp.login('dddddddd-0000-0000-0000-000000000009');
create temp table t3 as
select * from public.admin_save_template(null, '{"name":"Arms Day","program":"Extras","position":1}',
  jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'barbell_curl'), 'target_sets', 3, 'target_reps_min', 10)));
select pg_temp.check((select owner_id is null and program = 'Extras' from t3), 'admin creates a ready-made template');
select public.admin_save_template((select id from t3), '{"name":"Arms Day+","program":"Extras"}',
  jsonb_build_array(jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'hammer_curl'), 'target_sets', 4)));
select public.admin_set_template_hidden((select id from t3), true);
select pg_temp.logout();

select pg_temp.login('dddddddd-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 0 from public.templates where name = 'Arms Day+'), 'hidden ready-made template is invisible to users');
select pg_temp.logout();

select pg_temp.login('dddddddd-0000-0000-0000-000000000009');
select pg_temp.check((select count(*) = 1 from public.templates where name = 'Arms Day+'), 'admins still see hidden ones');
select public.admin_delete_template((select id from t3));
select pg_temp.check(
  (select array_agg(action order by id) = array['template.create', 'template.update', 'template.hide', 'template.delete']
     and bool_and(admin_id = 'dddddddd-0000-0000-0000-000000000009' and target_id = (select id::text from t3))
   from public.admin_actions where target_type = 'template'),
  'every admin template action is logged');
select pg_temp.logout();

rollback;
\echo 'templates tests passed'
