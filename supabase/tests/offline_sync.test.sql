-- Offline sync: retries don't duplicate, last write wins by the time the
-- change was made on the device, deletes leave tombstones.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('cccc0000-0000-0000-0000-000000000001', 'sync@test.dev');
select pg_temp.new_user('cccc0000-0000-0000-0000-000000000002', 'sync-other@test.dev');

create function pg_temp.bench() returns uuid language sql as $$ select id from public.exercises where slug = 'barbell_bench_press' $$;

-- Saves workout W with one bench set (weight given) and an edit time.
create function pg_temp.save(name text, weight numeric, changed text) returns public.workouts language sql as $$
  select public.save_workout(
    jsonb_build_object('id', 'dddd0000-0000-0000-0000-000000000001', 'name', name,
      'started_at', '2026-10-20T10:00:00Z', 'ended_at', '2026-10-20T11:00:00Z',
      'client_updated_at', changed),
    jsonb_build_array(jsonb_build_object('id', 'eeee0000-0000-0000-0000-000000000001',
      'exercise_id', pg_temp.bench(), 'exercise_order', 0, 'set_order', 0, 'weight_kg', weight, 'reps', 5)))
$$;
create function pg_temp.w() returns public.workouts language sql as $$
  select * from public.workouts where id = 'dddd0000-0000-0000-0000-000000000001'
$$;

select pg_temp.login('cccc0000-0000-0000-0000-000000000001');

-- Retries with the same ids: one workout, one set, one record.
select pg_temp.save('Push', 100, '2026-10-20T11:00:00Z');
select pg_temp.save('Push', 100, '2026-10-20T11:00:00Z');
select pg_temp.save('Push', 100, '2026-10-20T11:00:00Z');
select pg_temp.check((select count(*) = 1 from public.workouts), 'sending the same workout 3 times stores it once');
select pg_temp.check((select count(*) = 1 from public.workout_sets), 'and its set once');
select pg_temp.check((select count(*) = 1 from public.personal_records where record_type = 'heaviest_weight'), 'and one PR');
select pg_temp.check((select total_volume_kg = 500 from pg_temp.w()), 'totals still computed on the server');

-- Last write wins, by the time the change was made.
select pg_temp.save('Push (phone, later)', 105, '2026-10-21T09:00:00Z');
select pg_temp.check((select (pg_temp.save('Push (laptop, earlier)', 90, '2026-10-21T08:00:00Z')).name = 'Push (phone, later)'),
  'an older edit arriving late is ignored and the stored version returned');
select pg_temp.check((select name = 'Push (phone, later)' and total_volume_kg = 525 from pg_temp.w()), 'stored workout unchanged');
select pg_temp.check((select value = 105 from public.personal_records where record_type = 'heaviest_weight'), 'PR still from the newer edit');
select pg_temp.save('Push (newest)', 110, '2026-10-21T10:00:00Z');
select pg_temp.check((select name = 'Push (newest)' from pg_temp.w()), 'a newer edit wins');
select pg_temp.save('Future clock', 110, '2099-01-01T00:00:00Z');
select pg_temp.check((select client_updated_at <= now() from pg_temp.w()), 'a device clock in the future is capped at now');
select pg_temp.save('Newest', 110, null);
select pg_temp.check((select name = 'Newest' from pg_temp.w()), 'without a device time, the server time is used');

-- Deletes: an older delete loses to a newer edit; tombstones stop old edits.
select pg_temp.logout();
update public.workouts set client_updated_at = '2026-10-22T10:00:00Z' where id = 'dddd0000-0000-0000-0000-000000000001';
select pg_temp.login('cccc0000-0000-0000-0000-000000000001');
select public.delete_workout_at('dddd0000-0000-0000-0000-000000000001', '2026-10-22T09:00:00Z');
select pg_temp.check((select count(*) = 1 from public.workouts), 'a delete made before the last edit keeps the workout');
select public.delete_workout_at('dddd0000-0000-0000-0000-000000000001', '2026-10-22T11:00:00Z');
select pg_temp.check((select count(*) = 0 from public.workouts), 'a newer delete removes it');
select pg_temp.check((select count(*) = 0 from public.personal_records), 'and its records');
select public.delete_workout_at('dddd0000-0000-0000-0000-000000000001', '2026-10-22T11:00:00Z');
select pg_temp.check(true, 'deleting again (a retry) is fine');
select pg_temp.check((select (pg_temp.save('Old edit', 100, '2026-10-22T10:30:00Z')).id is null),
  'an edit made before the delete returns null');
select pg_temp.check((select count(*) = 0 from public.workouts), 'and does not bring the workout back');
select pg_temp.save('Re-added', 100, '2026-10-22T12:00:00Z');
select pg_temp.check((select count(*) = 1 from public.workouts), 'an edit made after the delete brings it back');
select public.delete_workout('dddd0000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 0 from public.workouts), 'delete_workout(id) still works (uses now)');
select pg_temp.expect_error($$select * from public.sync_tombstones$$, 'clients cannot read tombstones');
select pg_temp.expect_error($$select public._tombstone('workout', gen_random_uuid(), auth.uid(), now())$$, 'or write them');

-- Someone else's workout.
select pg_temp.logout();
delete from public.sync_tombstones;
select pg_temp.login('cccc0000-0000-0000-0000-000000000001');
select pg_temp.save('Mine', 100, '2026-10-23T10:00:00Z');
select pg_temp.login('cccc0000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select pg_temp.save('Hijack', 1, '2099-01-01')$$, 'another user cannot overwrite it, even with a newer time');
select pg_temp.expect_error($$select public.delete_workout_at('dddd0000-0000-0000-0000-000000000001', now())$$, 'or delete it');
select pg_temp.login('cccc0000-0000-0000-0000-000000000001');
select pg_temp.check((select name = 'Mine' from pg_temp.w()), 'it is untouched');

-- Templates: the app's id, retries, last write wins, tombstones.
create function pg_temp.tpl(name text, changed text) returns public.templates language sql as $$
  select public.save_template('ffff0000-0000-0000-0000-000000000001',
    jsonb_build_object('name', name, 'client_updated_at', changed),
    jsonb_build_array(jsonb_build_object('exercise_id', pg_temp.bench(), 'target_sets', 3)))
$$;
select pg_temp.tpl('Upper', '2026-10-20T10:00:00Z');
select pg_temp.tpl('Upper', '2026-10-20T10:00:00Z');
select pg_temp.check((select count(*) = 1 from public.templates where owner_id = auth.uid() and id = 'ffff0000-0000-0000-0000-000000000001'),
  'a new template keeps the app''s id and a retry doesn''t duplicate it');
select pg_temp.check((select count(*) = 1 from public.template_exercises where template_id = 'ffff0000-0000-0000-0000-000000000001'), 'exercises once');
select pg_temp.tpl('Upper B', '2026-10-21T10:00:00Z');
select pg_temp.check((select (pg_temp.tpl('Upper A', '2026-10-21T09:00:00Z')).name = 'Upper B'), 'older template edit ignored');
select pg_temp.expect_error($$select public.save_template('ffff0000-0000-0000-0000-000000000002', '{"name": "Empty"}', '[]')$$,
  'an invalid new template is rejected');
select pg_temp.check((select count(*) = 0 from public.templates where id = 'ffff0000-0000-0000-0000-000000000002'), 'and nothing is left behind');
select public.delete_template('ffff0000-0000-0000-0000-000000000001', '2026-10-21T09:30:00Z');
select pg_temp.check((select count(*) = 1 from public.templates where id = 'ffff0000-0000-0000-0000-000000000001'), 'older delete loses to newer edit');
select public.delete_template('ffff0000-0000-0000-0000-000000000001', '2026-10-21T11:00:00Z');
select pg_temp.check((select count(*) = 0 from public.templates where id = 'ffff0000-0000-0000-0000-000000000001'), 'newer delete removes it');
select pg_temp.check((select (pg_temp.tpl('Upper C', '2026-10-21T10:30:00Z')).id is null), 'older edit after delete returns null');
select pg_temp.check((select count(*) = 0 from public.templates where id = 'ffff0000-0000-0000-0000-000000000001'), 'and stays deleted');
select pg_temp.expect_error(
  format('select public.delete_template(%L)', (select id from public.templates where owner_id is null limit 1)),
  'cannot delete a ready-made template');
select pg_temp.expect_error(
  format('select public.save_template(%L, %L, %L)', (select id from public.templates where owner_id is null limit 1),
    '{"name": "Mine now"}', jsonb_build_array(jsonb_build_object('exercise_id', pg_temp.bench()))),
  'cannot take over a ready-made template by its id');

select pg_temp.tpl('Upper D', '2026-10-22T10:00:00Z');
select pg_temp.login('cccc0000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select pg_temp.tpl('Stolen', '2099-01-01')$$, 'another user cannot overwrite my template by id');
select pg_temp.expect_error($$select public.delete_template('ffff0000-0000-0000-0000-000000000001')$$, 'or delete it');
select pg_temp.logout();
select pg_temp.check((select name = 'Upper D' from public.templates where id = 'ffff0000-0000-0000-0000-000000000001'), 'my template is untouched');

rollback;
\echo 'offline sync tests passed'
