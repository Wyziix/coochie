-- Stage 8: points from workouts (server only), recalculated on edit/delete,
-- no double counting, anti-cheat flags and review, ban/hide, leaderboards,
-- levels, Madrid weeks.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('d8d80000-0000-0000-0000-00000000000a', 'pts-a@test.dev');
select pg_temp.new_user('d8d80000-0000-0000-0000-00000000000b', 'pts-b@test.dev');
select pg_temp.new_user('d8d80000-0000-0000-0000-00000000000c', 'pts-admin@test.dev');
update public.profiles set username = 'strong_a', bodyweight_kg = 90, training_days_per_week = 3
where id = 'd8d80000-0000-0000-0000-00000000000a';
update public.profiles set username = 'light_b', bodyweight_kg = 55, training_days_per_week = 3
where id = 'd8d80000-0000-0000-0000-00000000000b';
update public.profiles set username = 'pts_admin', role = 'admin' where id = 'd8d80000-0000-0000-0000-00000000000c';

create function pg_temp.ex(slug text) returns uuid language sql as $$ select id from public.exercises where exercises.slug = $1 $$;
create function pg_temp.w(n int) returns uuid language sql as $$ select ('e8e80000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Saves a workout as the user (like the app or an offline sync): one warm-up
-- plus `sets` working sets. `logged_at` = when the server first got it.
create function pg_temp.lift(u text, n int, at timestamptz, slug text, weight numeric, sets int,
                             minutes int default 50, logged_at timestamptz default null)
returns void language plpgsql as $$
begin
  perform pg_temp.login(u::uuid);
  perform public.save_workout(
    jsonb_build_object('id', pg_temp.w(n), 'name', 'Session ' || n, 'started_at', at,
                       'ended_at', at + make_interval(mins => minutes), 'client_updated_at', now()),
    (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', pg_temp.ex(slug), 'exercise_order', 0,
       'set_order', i, 'weight_kg', case when i = 0 then round(weight / 2) else weight end, 'reps', 8,
       'set_type', case when i = 0 then 'warmup' else 'normal' end))
     from generate_series(0, sets) i));
  perform pg_temp.logout();
  -- Workouts in these tests were "logged" when they happened, unless said otherwise.
  update public.workouts set created_at = coalesce(logged_at, at) where id = pg_temp.w(n);
  perform public._flag_workout(pg_temp.w(n));
  perform public.recompute_points(u::uuid);
end $$;
create function pg_temp.total(u text) returns bigint language sql as $$
  select coalesce(sum(points), 0) from public.points_ledger where user_id = u::uuid
$$;
create function pg_temp.status(n int) returns text language sql as $$
  select status from public.workout_flags where workout_id = pg_temp.w(n)
$$;

-- Week of Mon 2026-10-05 (Madrid): three sessions.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 1, '2026-10-05 18:00+02', 'barbell_bench_press', 60, 4);
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000a') = 54), 'a workout: 50 + 4 working sets × 1 (warm-up not counted)');
select pg_temp.check((select count(*) = 2 and bool_and(source_type = 'workout' and source_id = pg_temp.w(1)::text)
  from public.points_ledger where user_id = 'd8d80000-0000-0000-0000-00000000000a'), 'every row has a reason and a source');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 2, '2026-10-07 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.check((select points = 15 and details -> 'exercises' ? 'Bench Press (Barbell)' from public.points_ledger
  where reason = 'pr' and workout_id = pg_temp.w(2)), 'heavier than before: PR bonus 15');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 3, '2026-10-09 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.check((select not exists (select 1 from public.points_ledger where reason = 'pr' and workout_id = pg_temp.w(3))),
  'matching the best is not a PR');
select pg_temp.check((select points = 100 and workout_id = pg_temp.w(3) and source_id = '2026-10-05' from public.points_ledger
  where reason = 'weekly_goal' and user_id = 'd8d80000-0000-0000-0000-00000000000a'), 'weekly goal (3 planned days) hit by the 3rd session: 100');
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000a') = 277), 'week 1: 54 + 69 + 54 + 100 = 277');

-- Re-syncs and edits never double count.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 2, '2026-10-07 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 2, '2026-10-07 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000a') = 277
  and (select count(*) from public.points_ledger where workout_id = pg_temp.w(2)) = 3), 'the same workout synced twice more: still 277');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 2, '2026-10-07 18:00+02', 'barbell_bench_press', 62.5, 5);
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000a') = 278), 'editing it to 5 sets: recalculated (+1)');

-- Week 2 keeps the streak going.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 4, '2026-10-12 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 5, '2026-10-14 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000a', 6, '2026-10-16 18:00+02', 'barbell_bench_press', 62.5, 4);
select pg_temp.check((select points = 20 and details ->> 'weeks' = '2' from public.points_ledger
  where reason = 'streak' and user_id = 'd8d80000-0000-0000-0000-00000000000a'), '2nd week in a row: streak +20');
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000a') = 560), 'week 2: 3 × 54 + 100 + 20 = 282 more');

-- Deleting a workout removes its points (and the week's bonus it completed).
select pg_temp.login('d8d80000-0000-0000-0000-00000000000a');
select public.delete_workout(pg_temp.w(5));
select pg_temp.logout();
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000a') = 386
  and not exists (select 1 from public.points_ledger where source_id = '2026-10-12')), 'deleted: −54, and week 2 is no longer complete');

-- Fair: lighter lifter, same training, same points.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 11, '2026-10-05 19:00+02', 'barbell_bench_press', 25, 4);
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 12, '2026-10-07 19:00+02', 'barbell_bench_press', 27.5, 4);
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 13, '2026-10-09 19:00+02', 'barbell_bench_press', 27.5, 4);
select pg_temp.check((select pg_temp.total('d8d80000-0000-0000-0000-00000000000b') = 277),
  'same sessions with 25-27.5 kg instead of 60-62.5 kg: the same 277 points');

-- Daily cap (from settings, logged): what goes over is cut, with a reason.
select pg_temp.login('d8d80000-0000-0000-0000-00000000000c');
select public.admin_update_points_settings('{"daily_cap": 60}');
select pg_temp.logout();
select pg_temp.check((select points = -10 and details ->> 'cap' = '60' from public.points_ledger
  where reason = 'daily_cap' and workout_id = pg_temp.w(2)), 'cap 60 a day: 70 cut to 60 with a "daily_cap" row');
select pg_temp.check((select count(*) = 1 from public.admin_actions where action = 'points.settings'
  and (details -> 'before' ->> 'daily_cap')::int = 300), 'settings change logged with the old value');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000c');
select public.admin_update_points_settings('{"daily_cap": 300}');
select pg_temp.expect_error($$select public.admin_update_points_settings('{"daily_cap": -5}')$$, 'values are range-checked');
select pg_temp.expect_error($$select public.admin_update_points_settings('{"timezone": "UTC"}')$$, 'unknown or fixed settings rejected');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.admin_update_points_settings('{"workout_points": 9999}')$$, 'non-admins can''t change points');
select pg_temp.expect_error($$insert into public.points_ledger (user_id, points, reason, source_type, source_id, earned_at, day)
  values (auth.uid(), 1000, 'workout', 'workout', 'x', now(), current_date)$$, 'nobody can write points from the app');
select pg_temp.logout();

-- Anti-cheat: flagged, no points until reviewed.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 20, '2026-10-10 10:00+02', 'dumbbell_curl', 500, 3);
select pg_temp.check((select pg_temp.status(20) = 'pending' and reasons @> '[{"reason": "unrealistic_weight"}]'
  from public.workout_flags where workout_id = pg_temp.w(20)), '500 kg curl at 55 kg bodyweight: flagged');
select pg_temp.check((select not exists (select 1 from public.points_ledger where workout_id = pg_temp.w(20))), 'and gets no points');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 21, '2026-10-11 10:00+02', 'barbell_bench_press', 60, 3);
select pg_temp.check((select reasons @> '[{"reason": "big_jump", "previous_kg": 27.5}]' from public.workout_flags where workout_id = pg_temp.w(21)),
  'bench 27.5 → 60 kg: huge jump flagged');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 22, '2026-10-11 12:00+02', 'barbell_bench_press', 27.5, 3, 4);
select pg_temp.check((select reasons @> '[{"reason": "too_short"}]' from public.workout_flags where workout_id = pg_temp.w(22)), '4-minute workout flagged');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 23, '2026-10-11 14:00+02', 'barbell_bench_press', 27.5, 3);
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 24, '2026-10-11 16:00+02', 'barbell_bench_press', 27.5, 3);
select pg_temp.check((select pg_temp.status(23) is null and reasons @> '[{"reason": "too_many_today"}]'
  from public.workout_flags where workout_id = pg_temp.w(24)), '4th workout of the day flagged (3rd is fine)');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000b');
select public.delete_workout(pg_temp.w(21));
select pg_temp.logout();
select pg_temp.check((select pg_temp.status(24) is null), 'after deleting one, it''s the 3rd of the day: flag removed');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 25, '2026-10-01 10:00+02', 'barbell_bench_press', 25, 3,
  50, '2026-10-20 10:00+02');
select pg_temp.check((select reasons @> '[{"reason": "backdated"}]' from public.workout_flags where workout_id = pg_temp.w(25)),
  'logged 19 days after it happened: flagged');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 26, '2026-10-02 10:00+02', 'barbell_bench_press', 25, 3,
  50, '2026-10-05 10:00+02');
select pg_temp.check((select pg_temp.status(26) is null), 'synced 3 days later (offline): fine');

-- The user only sees "under review", not the reasons.
select pg_temp.login('d8d80000-0000-0000-0000-00000000000b');
select pg_temp.check((select public.workout_points(pg_temp.w(20)) ->> 'review' = 'pending'
  and (public.workout_points(pg_temp.w(20)) ->> 'points')::int = 0
  and public.workout_points(pg_temp.w(20))::text not like '%unrealistic%'), 'the user sees "under review", no reasons');
select pg_temp.expect_error($$select * from public.workout_flags$$, 'flags table is not readable by users');
select pg_temp.check((select public.workout_points(pg_temp.w(1)) is null), 'nor anyone else''s workout points');
select pg_temp.check((select (public.my_points() ->> 'under_review')::int = 3), 'my points: 3 workouts under review');

-- Admin review.
select pg_temp.expect_error($$select public.admin_flagged_workouts()$$, 'only admins see flagged workouts');
select pg_temp.check((select public.points_rules() @> '{"workout_points": 50, "weekly_goal_points": 100}'
  and not public.points_rules() ? 'flag_max_set_kg'), 'users see the point values, not the anti-cheat thresholds');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000c');
select pg_temp.check((select jsonb_array_length(public.admin_flagged_workouts()) = 3), 'admin: 3 pending');
select pg_temp.check((select (x -> 'sets' -> 1 ->> 'weight_kg')::numeric = 500 and x ->> 'username' = 'light_b' and x -> 'reasons' -> 0 ->> 'limit_kg' is not null
  from jsonb_array_elements(public.admin_flagged_workouts()) x where x ->> 'workout_id' = pg_temp.w(20)::text),
  'with the reasons and the sets');
select public.admin_review_workout(pg_temp.w(22), true);
select public.admin_review_workout(pg_temp.w(20), false);
select pg_temp.logout();
select pg_temp.check((select exists (select 1 from public.points_ledger where workout_id = pg_temp.w(22) and reason = 'workout')),
  'approved: points granted');
select pg_temp.check((select not exists (select 1 from public.points_ledger where workout_id = pg_temp.w(20))
  and pg_temp.status(20) = 'rejected'), 'rejected: no points');
select pg_temp.check((select count(*) = 2 from public.admin_actions where action in ('points.approve', 'points.reject')), 'reviews are logged');
-- Editing an approved workout: same reason stays approved, a new reason goes back to review.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 22, '2026-10-11 12:00+02', 'barbell_bench_press', 27.5, 4, 5);
select pg_temp.check((select pg_temp.status(22) = 'approved'), 'edited, still only "too short": stays approved');
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 22, '2026-10-11 12:00+02', 'barbell_bench_press', 400, 4, 5);
select pg_temp.check((select pg_temp.status(22) = 'pending'
  and not exists (select 1 from public.points_ledger where workout_id = pg_temp.w(22))), 'edited to 400 kg: back under review, no points');

-- Levels.
select pg_temp.check((select public.level_for(0) @> '{"level": 1, "name": "Rookie I", "min_points": 0, "next_points": 100}'), 'level 1: Rookie I');
select pg_temp.check((select public.level_for(100) ->> 'level' = '2' and public.level_for(560) ->> 'level' = '3'), 'level from total points');
select pg_temp.check((select public.level_for(10000000) @> '{"level": 50, "name": "Lightweight Baby V"}'
  and public.level_for(10000000) -> 'next_points' = 'null'), 'level 50 is the top: Lightweight Baby V');

-- Madrid weeks: Sunday 23:30 UTC in October is already Monday in Madrid.
select pg_temp.check((select public._points_day('2026-10-11 23:30+00') = '2026-10-12'
  and public._points_week_start(public._points_day('2026-10-11 23:30+00')) = '2026-10-12'
  and public._points_week_start('2026-10-18') = '2026-10-12'), 'weeks start on Monday, Europe/Madrid');

-- Leaderboards.
select pg_temp.lift('d8d80000-0000-0000-0000-00000000000b', 30, now() - interval '1 minute', 'barbell_bench_press', 27.5, 4);
select pg_temp.login('d8d80000-0000-0000-0000-00000000000a');
create temp table lb as select public.leaderboard('all') as j;
grant select on lb to authenticated;
select pg_temp.check((select j -> 'entries' -> 0 ->> 'rank' = '1' and j -> 'entries' -> 1 ->> 'rank' = '2'
  and (j -> 'entries' -> 0 ->> 'points')::int > (j -> 'entries' -> 1 ->> 'points')::int
  and (select count(*) from jsonb_array_elements(j -> 'entries') e where (e ->> 'is_me')::boolean and e ->> 'username' = 'strong_a') = 1
  and (j -> 'me' ->> 'points')::int = 386 from lb), 'all-time: ranked by points, me marked');
select pg_temp.check((select (select array_agg(k order by k) from jsonb_object_keys(j -> 'entries' -> 0) k)
  = '{avatar_url,is_me,level,points,rank,username}' from lb), 'entries show only username, avatar, level, points (and rank)');
select pg_temp.check((select (public.leaderboard('week') -> 'entries' -> 0 ->> 'username') = 'light_b'
  and (public.leaderboard('week') -> 'me' ->> 'rank') is null and (public.leaderboard('week') -> 'me' ->> 'points')::int = 0),
  'this week: only this week''s points; me shown with 0 and no rank');
select pg_temp.expect_error($$select * from public.leaderboard_totals$$, 'the view itself isn''t readable');
-- "Hide me": gone from others' boards, still see my own (would-be) rank.
select pg_temp.login('d8d80000-0000-0000-0000-00000000000b');
update public.profiles set leaderboard_hidden = true where id = auth.uid();
select pg_temp.check((select (public.leaderboard('all') -> 'me' ->> 'hidden')::boolean
  and (public.leaderboard('all') -> 'me' ->> 'rank') is not null), 'hidden: I still see my rank');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000a');
select pg_temp.check((select jsonb_array_length(public.leaderboard('all') -> 'entries') = 1), 'others don''t see me');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000b');
update public.profiles set leaderboard_hidden = false where id = auth.uid();
-- Admin ban and hide.
select pg_temp.expect_error($$select public.admin_set_user_moderation(auth.uid(), false, false)$$, 'users can''t moderate');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000c');
select public.admin_set_user_moderation('d8d80000-0000-0000-0000-00000000000a', true, false, 'Fake numbers');
select pg_temp.check((select x @> '{"leaderboard_banned": true, "note": "Fake numbers"}'
  from jsonb_array_elements(public.admin_users('strong')) x), 'admin users list shows the ban');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000b');
select pg_temp.check((select public.leaderboard('all') -> 'entries' -> 0 ->> 'username' = 'light_b'
  and jsonb_array_length(public.leaderboard('all') -> 'entries') = 1), 'banned user is off the boards');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000a');
select pg_temp.check((select public.leaderboard('all') -> 'me' @> '{"removed": true, "rank": null}'), 'and sees no rank');
select pg_temp.check((select (public.my_points() ->> 'total')::int = 386), 'but keeps the points');
select pg_temp.login('d8d80000-0000-0000-0000-00000000000c');
select public.admin_set_user_moderation('d8d80000-0000-0000-0000-00000000000a', false, true);
select pg_temp.check((select (x ->> 'hidden')::boolean and not (x ->> 'leaderboard_banned')::boolean
  from jsonb_array_elements(public.admin_users('strong')) x), 'hide (instead of ban)');
select pg_temp.check((select jsonb_array_length(public.admin_user_ledger('d8d80000-0000-0000-0000-00000000000a')) > 0
  and public.admin_user_ledger('d8d80000-0000-0000-0000-00000000000a') -> 0 ? 'workout'), 'admin sees why someone has their points');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.admin_actions where action = 'user.moderation'), 'ban and hide are logged');
select pg_temp.check((select count(*) = 1 from public.points_ledger where user_id = 'd8d80000-0000-0000-0000-00000000000b'
  and reason = 'workout' and workout_id = pg_temp.w(30)), 'a workout from today counts once');

rollback;
\echo 'points tests passed'
