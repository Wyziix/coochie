-- Exercises, workouts and sets: ownership, save_workout and last_exercise_sets.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('bbbbbbbb-0000-0000-0000-000000000001', 'a@test.dev');
select pg_temp.new_user('bbbbbbbb-0000-0000-0000-000000000002', 'b@test.dev');

select pg_temp.check((select count(*) >= 80 from public.exercises where owner_id is null), 'at least 80 global exercises seeded');

-- User A: custom exercise.
select pg_temp.login('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.exercises (name, primary_muscle, equipment, type, owner_id)
values ('My Weird Curl', 'biceps', 'band', 'weights', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 1 from public.exercises where name = 'My Weird Curl'), 'user sees own custom exercise');
select pg_temp.expect_error(
  $$insert into public.exercises (name, primary_muscle, equipment, type, owner_id) values ('Fake', 'chest', 'band', 'weights', 'bbbbbbbb-0000-0000-0000-000000000002')$$,
  'cannot create a custom exercise for someone else');
select pg_temp.expect_error(
  $$insert into public.exercises (name, primary_muscle, equipment, type, owner_id, slug) values ('Fake 2', 'chest', 'band', 'weights', 'bbbbbbbb-0000-0000-0000-000000000001', 'fake')$$,
  'custom exercises cannot take a global slug');

-- Save a workout.
select pg_temp.check((
  select (public.save_workout(
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001', 'name', 'Push', 'started_at', '2026-10-01T10:00:00Z', 'ended_at', '2026-10-01T11:00:00Z'),
    jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 0, 'set_type', 'warmup', 'weight_kg', 40, 'reps', 10),
      jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 1, 'set_type', 'normal', 'weight_kg', 80, 'reps', 5, 'rpe', 8),
      jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 2, 'set_type', 'normal', 'weight_kg', 80, 'reps', 5),
      jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'push_up'), 'exercise_order', 1, 'set_order', 0, 'reps', 20)
    )
  )).total_volume_kg = 800),
  'save_workout computes volume from working sets only');
select pg_temp.check((select duration_seconds = 3600 from public.workouts), 'save_workout computes duration on the server');
select pg_temp.check((select count(*) = 4 from public.workout_sets), 'all sets saved');

-- Saving the same id again replaces sets instead of duplicating.
select public.save_workout(
  jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001', 'name', 'Push day', 'started_at', '2026-10-01T10:00:00Z', 'ended_at', '2026-10-01T11:30:00Z'),
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 85, 'reps', 5))
);
select pg_temp.check((select count(*) = 1 from public.workouts) and (select count(*) = 1 from public.workout_sets),
  'saving twice is idempotent (no duplicates)');
select pg_temp.check((select name = 'Push day' and total_volume_kg = 425 from public.workouts), 'second save updates the workout');

select pg_temp.expect_error(
  $$select public.save_workout(jsonb_build_object('id', gen_random_uuid(), 'name', 'Empty', 'started_at', now(), 'ended_at', now()), '[]'::jsonb)$$,
  'cannot save a workout without sets');
select pg_temp.expect_error(
  $$select public.save_workout(jsonb_build_object('id', gen_random_uuid(), 'name', 'Bad', 'started_at', now(), 'ended_at', now() - interval '1 hour'),
     jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'deadlift'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 100, 'reps', 5)))$$,
  'cannot save a workout that ends before it starts');
select pg_temp.expect_error(
  $$select public.save_workout(jsonb_build_object('id', gen_random_uuid(), 'name', 'Bad', 'started_at', now(), 'ended_at', now()),
     jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'deadlift'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 5000, 'reps', 5)))$$,
  'unrealistic set weight rejected');

-- An older workout, to check "last time" picks the most recent.
select public.save_workout(
  jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000002', 'name', 'Old', 'started_at', '2026-09-01T10:00:00Z', 'ended_at', '2026-09-01T11:00:00Z'),
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'barbell_bench_press'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 60, 'reps', 8))
);
select pg_temp.check((
  select count(*) = 1 and max(weight_kg) = 85
  from public.last_exercise_sets(array[(select id from public.exercises where slug = 'barbell_bench_press')])
), 'last_exercise_sets returns the most recent workout''s sets');

insert into public.user_exercise_settings (exercise_id, rest_seconds)
values ((select id from public.exercises where slug = 'deadlift'), 240);
select pg_temp.logout();

-- User B sees none of it.
select pg_temp.login('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) = 0 from public.workouts), 'other user cannot see workouts');
select pg_temp.check((select count(*) = 0 from public.workout_sets), 'other user cannot see sets');
select pg_temp.check((select count(*) = 0 from public.user_exercise_settings), 'other user cannot see rest settings');
select pg_temp.check((select count(*) = 0 from public.exercises where name = 'My Weird Curl'), 'other user cannot see custom exercises');
select pg_temp.check((select count(*) = 0 from public.last_exercise_sets(array[(select id from public.exercises where slug = 'barbell_bench_press')])),
  'last_exercise_sets only uses own history');
select pg_temp.expect_error(
  $$select public.save_workout(jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000001', 'name', 'Hijack', 'started_at', now(), 'ended_at', now()),
     jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', (select id from public.exercises where slug = 'deadlift'), 'exercise_order', 0, 'set_order', 0, 'weight_kg', 100, 'reps', 5)))$$,
  'cannot overwrite another user''s workout by reusing its id');
select pg_temp.expect_error(
  $$insert into public.workout_sets (id, workout_id, exercise_id, exercise_order, set_order, weight_kg, reps)
    values (gen_random_uuid(), 'cccccccc-0000-0000-0000-000000000001', (select id from public.exercises where slug = 'deadlift'), 5, 0, 100, 5)$$,
  'cannot add sets to another user''s workout');
select pg_temp.logout();

-- Hidden global exercises stay readable (old workouts keep their names).
update public.exercises set is_hidden = true where slug = 'barbell_bench_press';
select pg_temp.login('bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 1 from public.exercises where slug = 'barbell_bench_press'), 'hidden exercise still readable');
select pg_temp.logout();

rollback;
\echo 'workouts tests passed'
