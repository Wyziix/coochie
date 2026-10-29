-- Personal records (recomputed on save / edit / delete), celebration data,
-- chart data, weekly overview, body measurements and progress photos.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('99999999-0000-0000-0000-000000000001', 'pr@test.dev');
select pg_temp.new_user('99999999-0000-0000-0000-000000000002', 'other@test.dev');

create function pg_temp.bench() returns uuid language sql as $$ select id from public.exercises where slug = 'barbell_bench_press' $$;
create function pg_temp.plank() returns uuid language sql as $$ select id from public.exercises where slug = 'plank' $$;

-- Saves a workout with bench sets given as [[weight, reps, type], ...].
create function pg_temp.bench_workout(wid text, day text, sets jsonb) returns void language plpgsql as $$
begin
  perform public.save_workout(
    jsonb_build_object('id', wid, 'name', 'W ' || day, 'started_at', day || 'T10:00:00Z', 'ended_at', day || 'T11:00:00Z'),
    (select jsonb_agg(jsonb_build_object(
       'id', gen_random_uuid(), 'exercise_id', pg_temp.bench(), 'exercise_order', 0, 'set_order', ord - 1,
       'weight_kg', (x ->> 0)::numeric, 'reps', (x ->> 1)::int, 'set_type', coalesce(x ->> 2, 'normal')))
     from jsonb_array_elements(sets) with ordinality as t(x, ord)));
end $$;

create function pg_temp.pr(rt text, bucket numeric default 0) returns public.personal_records language sql as $$
  select * from public.personal_records
  where exercise_id = pg_temp.bench() and record_type = rt::public.record_type and bucket_kg = bucket
$$;

select pg_temp.login('99999999-0000-0000-0000-000000000001');

-- Workout 1 (Sep 1): 100x5, warm-up 120x1 (ignored).
select pg_temp.bench_workout('a0000000-0000-0000-0000-000000000001', '2026-09-01', '[[100,5],[120,1,"warmup"]]');
select pg_temp.check((select value = 100 and previous_value is null from pg_temp.pr('heaviest_weight')), 'first workout sets heaviest weight, no previous');
select pg_temp.check((select value = 116.67 from pg_temp.pr('best_e1rm')), 'Epley e1RM: 100 × (1 + 5/30) = 116.67');
select pg_temp.check((select value = 500 from pg_temp.pr('session_volume')), 'session volume 500');
select pg_temp.check((select count(*) = 0 from public.workout_records('a0000000-0000-0000-0000-000000000001')),
  'first time is not celebrated as a PR');

-- Workout 2 (Sep 8): 105x3, 100x6.
select pg_temp.bench_workout('a0000000-0000-0000-0000-000000000002', '2026-09-08', '[[105,3],[100,6]]');
select pg_temp.check((select value = 105 and previous_value = 100 and workout_id = 'a0000000-0000-0000-0000-000000000002' from pg_temp.pr('heaviest_weight')),
  'heavier set becomes the PR, previous best recorded');
select pg_temp.check((select value = 6 and previous_value = 5 from pg_temp.pr('reps_at_weight', 100)), 'most reps at 100 kg: 6 (was 5)');
select pg_temp.check((select value = 120 and previous_value = 116.67 from pg_temp.pr('best_e1rm')), 'e1RM 100x6 = 120 beats 116.67');
select pg_temp.check((select value = 915 and previous_value = 500 from pg_temp.pr('session_volume')), 'session volume 915');
select pg_temp.check(
  (select array_agg(record_type::text order by record_type) from public.workout_records('a0000000-0000-0000-0000-000000000002'))
    = array['heaviest_weight', 'best_e1rm', 'reps_at_weight', 'session_volume'],
  'workout_records returns the real improvements (105 kg is a first at that weight, so no reps record for it)');

-- Workout 3 (Sep 15) ties 105x3: equalling is not a new record.
select pg_temp.bench_workout('a0000000-0000-0000-0000-000000000003', '2026-09-15', '[[105,3]]');
select pg_temp.check((select workout_id = 'a0000000-0000-0000-0000-000000000002' from pg_temp.pr('heaviest_weight')), 'a tie keeps the earlier record');
select pg_temp.check((select count(*) = 0 from public.workout_records('a0000000-0000-0000-0000-000000000003')), 'a tie is not celebrated');

-- Edit workout 2 down to 90x5: workout 1 is the best again, workout 3 holds the 105.
select pg_temp.bench_workout('a0000000-0000-0000-0000-000000000002', '2026-09-08', '[[90,5]]');
select pg_temp.check((select value = 105 and workout_id = 'a0000000-0000-0000-0000-000000000003' and previous_value = 100 from pg_temp.pr('heaviest_weight')),
  'after editing, the next best set (workout 3) holds the heaviest record');
select pg_temp.check((select value = 5 and workout_id = 'a0000000-0000-0000-0000-000000000001' from pg_temp.pr('reps_at_weight', 100)),
  'reps record at 100 kg goes back to workout 1');
select pg_temp.check((select count(*) = 0 from pg_temp.pr('reps_at_weight', 90) where previous_value is not null), '90 kg is a first, no previous');

-- Delete workout 3: workout 1 holds the heaviest record again.
select public.delete_workout('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select value = 100 and workout_id = 'a0000000-0000-0000-0000-000000000001' and previous_value is null from pg_temp.pr('heaviest_weight')),
  'deleting the record workout makes the previous best the record again');
select pg_temp.check((select count(*) = 0 from public.personal_records where workout_id = 'a0000000-0000-0000-0000-000000000003'),
  'records of the deleted workout are gone');

-- Removing an exercise from a workout by editing recomputes it too.
select public.save_workout(
  jsonb_build_object('id', 'a0000000-0000-0000-0000-000000000001', 'name', 'W', 'started_at', '2026-09-01T10:00:00Z', 'ended_at', '2026-09-01T11:00:00Z'),
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', pg_temp.plank(), 'exercise_order', 0, 'set_order', 0, 'duration_seconds', 90)));
select pg_temp.check((select value = 90 and workout_id = 'a0000000-0000-0000-0000-000000000002' from pg_temp.pr('heaviest_weight')),
  'bench removed from workout 1: workout 2 (90x5) is the only bench left');
select pg_temp.check((select value = 90 from public.personal_records where exercise_id = pg_temp.plank() and record_type = 'longest_duration'),
  'longest duration for timed exercises');

-- Chart data and overview.
select pg_temp.check((select count(*) = 1 and max(max_weight_kg) = 90 and max(volume_kg) = 450 from public.exercise_history(pg_temp.bench())),
  'exercise_history: one bench workout left, 90 kg, 450 volume');
select pg_temp.check((select count(*) = 0 from public.exercise_history(pg_temp.bench(), '2026-10-01')), 'exercise_history respects the since filter');
select pg_temp.check((select count(*) = 2 from public.trained_exercises()), 'trained_exercises lists bench and plank');
select pg_temp.check(
  (select (o ->> 'workouts')::int = 1 and (o ->> 'volume_kg')::numeric = 450
          and o -> 'muscles' -> 0 ->> 'muscle' = 'chest' and (o -> 'muscles' -> 0 ->> 'sets')::numeric = 1
   from public.weekly_overview('2026-09-07', '2026-09-14') o),
  'weekly_overview counts workouts, volume and muscles');

-- Records can't be written by clients.
select pg_temp.expect_error($$insert into public.personal_records (user_id, exercise_id, record_type, value, workout_id, achieved_at)
  values ('99999999-0000-0000-0000-000000000001', pg_temp.bench(), 'heaviest_weight', 999, 'a0000000-0000-0000-0000-000000000002', now())$$,
  'clients cannot insert records');
with u as (update public.personal_records set value = 999 returning 1)
select pg_temp.check((select count(*) = 0 from u), 'clients cannot change records');
select pg_temp.expect_error($$select public.recompute_records('99999999-0000-0000-0000-000000000001', array[pg_temp.bench()])$$,
  'clients cannot call recompute_records');

-- Body measurements update the profile's bodyweight.
insert into public.body_measurements (measured_on, bodyweight_kg) values ('2026-09-01', 82);
select pg_temp.check((select bodyweight_kg = 82 from public.profiles), 'logging bodyweight updates the profile');
insert into public.body_measurements (measured_on, bodyweight_kg) values ('2026-08-01', 85);
select pg_temp.check((select bodyweight_kg = 82 from public.profiles), 'an older entry does not overwrite the newest');
insert into public.body_measurements (measured_on, waist_cm) values ('2026-09-10', 80);
select pg_temp.check((select bodyweight_kg = 82 from public.profiles), 'an entry without bodyweight keeps the profile value');
delete from public.body_measurements where measured_on = '2026-09-01';
select pg_temp.check((select bodyweight_kg = 85 from public.profiles), 'deleting the newest falls back to the previous bodyweight');
select pg_temp.expect_error($$insert into public.body_measurements (measured_on, bodyweight_kg) values ('2026-08-01', 70)$$, 'one entry per day');
select pg_temp.expect_error($$insert into public.body_measurements (measured_on) values ('2026-07-01')$$, 'an empty entry is rejected');
select pg_temp.expect_error($$insert into public.body_measurements (measured_on, bodyweight_kg) values ('2026-07-02', 5)$$, 'unrealistic bodyweight rejected');
select pg_temp.expect_error($$insert into public.body_measurements (user_id, measured_on, bodyweight_kg) values ('99999999-0000-0000-0000-000000000002', '2026-07-03', 70)$$,
  'cannot log for someone else');

-- Progress photos.
insert into public.progress_photos (storage_path) values ('99999999-0000-0000-0000-000000000001/p1.jpg');
select pg_temp.expect_error($$insert into public.progress_photos (storage_path) values ('99999999-0000-0000-0000-000000000002/p2.jpg')$$,
  'photo row must point into own folder');
insert into storage.objects (bucket_id, name) values ('progress-photos', '99999999-0000-0000-0000-000000000001/p1.jpg');
select pg_temp.check(true, 'can upload a photo into own folder');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('progress-photos', '99999999-0000-0000-0000-000000000002/x.jpg')$$,
  'cannot upload into another user''s photo folder');
select pg_temp.logout();
select pg_temp.check((select not public from storage.buckets where id = 'progress-photos'), 'progress-photos bucket is private');

-- The other user sees none of it.
select pg_temp.login('99999999-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) = 0 from public.personal_records), 'other users cannot see records');
select pg_temp.check((select count(*) = 0 from public.workout_records('a0000000-0000-0000-0000-000000000002')), 'or another user''s celebration');
select pg_temp.check((select count(*) = 0 from public.exercise_history(pg_temp.bench())), 'or chart data');
select pg_temp.check((select count(*) = 0 from public.body_measurements), 'or body measurements');
select pg_temp.check((select count(*) = 0 from public.progress_photos), 'or photo rows');
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'progress-photos'), 'or photo files');
with d as (delete from storage.objects where bucket_id = 'progress-photos' returning 1)
select pg_temp.check((select count(*) = 0 from d), 'or delete them');
select pg_temp.logout();

rollback;
\echo 'progress tests passed'
