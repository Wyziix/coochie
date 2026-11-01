-- Stage 7: separate daily limits per feature, per-feature overrides, plans
-- saved as programs (deleted together), coach chat only for its owner, and
-- the compact summaries sent to Claude.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('c7c70000-0000-0000-0000-000000000001', 'coach-a@test.dev');
select pg_temp.new_user('c7c70000-0000-0000-0000-000000000002', 'coach-b@test.dev');
select pg_temp.new_user('c7c70000-0000-0000-0000-000000000003', 'coach-admin@test.dev');
update public.profiles set username = 'coach_a', goal = 'hypertrophy', experience_level = 'beginner',
  training_days_per_week = 3, units = 'kg', bodyweight_kg = 70
where id = 'c7c70000-0000-0000-0000-000000000001';
update public.profiles set username = 'coach_b' where id = 'c7c70000-0000-0000-0000-000000000002';
update public.profiles set username = 'coach_admin', role = 'admin' where id = 'c7c70000-0000-0000-0000-000000000003';

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.use(u text, f text, ref text) returns jsonb language plpgsql as $$
declare r jsonb := public.ai_reserve(u::uuid, f, ref, true);
begin
  if (r ->> 'ok')::boolean then perform public.ai_finish((r ->> 'id')::uuid, 'ok', 1000, 200, 0, 800); end if;
  return r;
end $$;

-- Defaults: feedback 3, plans 2, coach 15; plans get 1500 output tokens, coach 400.
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
select pg_temp.check((select public.ai_status() -> 'features' = '{
    "workout_feedback": {"limit": 3, "used": 0, "remaining": 3},
    "plan": {"limit": 2, "used": 0, "remaining": 2},
    "coach": {"limit": 15, "used": 0, "remaining": 15}}'::jsonb),
  'status: 3 feedback, 2 plans, 15 coach messages a day');
select pg_temp.as_service();
select pg_temp.check((select r ->> 'max_tokens' = '1500' from (select pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'plan', 'plan') r) x),
  'a plan gets 1500 output tokens');
select pg_temp.check((select r ->> 'max_tokens' = '400' from (select pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'coach', 'chat') r) x),
  'a coach reply gets 400');
select pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'plan', 'plan');
select pg_temp.check((select pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'plan', 'plan') = '{"ok": false, "reason": "limit", "limit": 2}'::jsonb),
  'the 3rd plan of the day is blocked');
select pg_temp.check((select (pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'workout_feedback', 'w1') ->> 'ok')::boolean),
  'but workout feedback has its own limit');
select pg_temp.check((select count(*) = 14 from generate_series(1, 14) n
  where (pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'coach', 'chat') ->> 'ok')::boolean), 'coach: 14 more (15 in all)');
select pg_temp.check((select pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'coach', 'chat') ->> 'reason' = 'limit'), 'the 16th coach message is blocked');
select pg_temp.check((select public.ai_reserve('c7c70000-0000-0000-0000-000000000001', 'coach', 'chat', true) ->> 'reason' = 'limit'),
  'and stays blocked');
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
select pg_temp.check((select public.ai_status() -> 'features' -> 'plan' = '{"limit": 2, "used": 2, "remaining": 0}'::jsonb
  and public.ai_status() ->> 'remaining' = '2'), 'status per feature (top level stays the feedback count)');

-- Admin: limits per feature, overrides per feature, all logged.
select pg_temp.expect_error($$select public.admin_update_ai_settings('{"limit_plan": 50}')$$, 'non-admins cannot change limits');
select pg_temp.expect_error($$select public.admin_set_ai_override(auth.uid(), 50, 'coach')$$, 'or give themselves more messages');
select pg_temp.login('c7c70000-0000-0000-0000-000000000003');
select pg_temp.check((select s ->> 'limit_plan' = '3' and s ->> 'limit_coach' = '20' and s ->> 'max_tokens_plan' = '1600'
  from (select public.admin_update_ai_settings('{"limit_plan": 3, "limit_coach": 20, "max_tokens_plan": 1600}') s) x),
  'admin changes the plan and coach limits');
select pg_temp.check((select s ->> 'limit_workout_feedback' = '4' and s ->> 'daily_limit' = '4'
  from (select public.admin_update_ai_settings('{"limit_workout_feedback": 4}') s) x), 'and the feedback limit');
select pg_temp.expect_error($$select public.admin_update_ai_settings('{"limit_coach": 5000}')$$, 'limits are range-checked');
select public.admin_set_ai_override('c7c70000-0000-0000-0000-000000000001', 0, 'plan');
select public.admin_set_ai_override('c7c70000-0000-0000-0000-000000000001', 30, 'coach');
select pg_temp.expect_error($$select public.admin_set_ai_override('c7c70000-0000-0000-0000-000000000001', 3, 'weekly_report')$$, 'only the three features');
select pg_temp.check((select count(*) = 2 from public.admin_ai_feature_overrides() where username = 'coach_a'), 'overrides listed per feature');
select pg_temp.as_service();
select pg_temp.check((select pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'plan', 'plan') ->> 'reason' = 'limit'), 'plan override 0 blocks plans');
select pg_temp.check((select (pg_temp.use('c7c70000-0000-0000-0000-000000000001', 'coach', 'chat') ->> 'ok')::boolean), 'coach override 30 allows more');
select pg_temp.login('c7c70000-0000-0000-0000-000000000003');
select public.admin_set_ai_override('c7c70000-0000-0000-0000-000000000001', null, 'plan');
select pg_temp.check((select count(*) = 1 from public.admin_ai_feature_overrides() where username = 'coach_a'), 'clearing an override removes only that feature');
select pg_temp.logout();
select pg_temp.check((select count(*) = 5 from public.admin_actions where admin_id = 'c7c70000-0000-0000-0000-000000000003'), 'every admin change is logged');

-- Kill switch and spending cap still apply to plans and coach.
select pg_temp.login('c7c70000-0000-0000-0000-000000000003');
select public.admin_update_ai_settings('{"enabled": false}');
select pg_temp.as_service();
select pg_temp.check((select public.ai_reserve('c7c70000-0000-0000-0000-000000000002', 'plan', 'plan', true) ->> 'reason' = 'disabled'
  and public.ai_reserve('c7c70000-0000-0000-0000-000000000002', 'coach', 'chat', true) ->> 'reason' = 'disabled'), 'kill switch blocks plans and coach');
select pg_temp.login('c7c70000-0000-0000-0000-000000000003');
select public.admin_update_ai_settings('{"enabled": true, "daily_budget_usd": 0.0001}');
select pg_temp.as_service();
select pg_temp.check((select public.ai_reserve('c7c70000-0000-0000-0000-000000000002', 'plan', 'plan', true) ->> 'reason' = 'budget'),
  'spending cap blocks plans');
select pg_temp.login('c7c70000-0000-0000-0000-000000000003');
select public.admin_update_ai_settings('{"daily_budget_usd": 0.5}');

-- Programs: a plan is saved as a program of templates.
create function pg_temp.ex(slug text) returns uuid language sql as $$ select id from public.exercises where exercises.slug = $1 $$;
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
create temp table prog as select public.save_ai_plan(
  '{"name": "3-day full body", "description": "Beginner plan", "weeks": 6, "notes": ["Add weight when you hit the top of the rep range."]}',
  jsonb_build_array(
    jsonb_build_object('p_template', '{"name": "Day A", "notes": "Squat focus"}'::jsonb,
      'p_exercises', jsonb_build_array(
        jsonb_build_object('exercise_id', pg_temp.ex('back_squat'), 'target_sets', 3, 'target_reps_min', 6, 'target_reps_max', 8, 'rest_seconds', 150),
        jsonb_build_object('exercise_id', pg_temp.ex('barbell_bench_press'), 'target_sets', 3, 'target_reps_min', 8, 'target_reps_max', 10))),
    jsonb_build_object('p_template', '{"name": "Day B"}'::jsonb,
      'p_exercises', jsonb_build_array(
        jsonb_build_object('exercise_id', pg_temp.ex('barbell_bench_press'), 'target_sets', 4, 'target_reps_min', 5, 'target_reps_max', 5))))
) as id;
grant select on prog to authenticated;
select pg_temp.check((select count(*) = 2 from public.templates t join prog on t.program_id = prog.id where t.owner_id = auth.uid()),
  'the plan becomes 2 templates of my own');
select pg_temp.check((select array_agg(name order by position) = '{Day A,Day B}' from public.templates t join prog on t.program_id = prog.id),
  'in plan order');
select pg_temp.check((select count(*) = 3 from public.template_exercises te join public.templates t on t.id = te.template_id join prog on t.program_id = prog.id),
  'with their exercises');
select pg_temp.check((select name = '3-day full body' and weeks = 6 and jsonb_array_length(notes) = 1 from public.user_programs), 'and the program');
select pg_temp.expect_error($$select public.save_ai_plan('{"name": "x"}', jsonb_build_array(jsonb_build_object('p_template', '{"name": "D"}'::jsonb,
  'p_exercises', jsonb_build_array(jsonb_build_object('exercise_id', gen_random_uuid())))))$$, 'unknown exercises are rejected');
select pg_temp.check((select count(*) = 1 from public.user_programs), 'and nothing is left behind');
select pg_temp.expect_error($$select public.save_ai_plan('{"name": "x"}', '[]')$$, 'a plan needs days');
-- Editing a template of a program keeps it in the program.
select public.save_template(t.id, '{"name": "Day A (edited)"}',
  jsonb_build_array(jsonb_build_object('exercise_id', pg_temp.ex('back_squat'))))
from public.templates t where t.name = 'Day A';
select pg_temp.check((select program_id = (select id from prog) from public.templates where name = 'Day A (edited)'), 'editing a day keeps it in the program');

-- Others can't see or delete it.
select pg_temp.login('c7c70000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) = 0 from public.user_programs), 'others cannot see my programs');
select pg_temp.expect_error($$select public.delete_program((select id from prog))$$, 'or delete them');
select pg_temp.expect_error($$insert into public.user_programs (user_id, name) values (auth.uid(), 'x')$$, 'programs are only written by save_ai_plan');

-- A workout from a program day survives deleting the program.
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
select public.save_workout(
  jsonb_build_object('id', 'd7d70000-0000-0000-0000-000000000001', 'name', 'Day B', 'started_at', now() - interval '2 days',
    'ended_at', now() - interval '2 days' + interval '50 minutes',
    'template_id', (select id from public.templates where name = 'Day B')),
  (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', pg_temp.ex('barbell_bench_press'), 'exercise_order', 0,
     'set_order', n, 'weight_kg', 60 + n * 2.5, 'reps', 8, 'set_type', 'normal')) from generate_series(0, 2) n));
select public.delete_program((select id from prog));
select pg_temp.check((select count(*) = 0 from public.user_programs) and (select count(*) = 0 from public.templates where owner_id = auth.uid()),
  'deleting a program deletes all its templates');
select pg_temp.check((select count(*) = 1 from public.workouts where id = 'd7d70000-0000-0000-0000-000000000001'), 'past workouts are kept');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.sync_tombstones where entity = 'template' and user_id = 'c7c70000-0000-0000-0000-000000000001'),
  'tombstones, so an offline edit can''t bring a day back');

-- Coach chat: only the owner reads or clears; nobody writes from the app.
select pg_temp.as_service();
insert into public.coach_messages (user_id, role, content) values
  ('c7c70000-0000-0000-0000-000000000001', 'user', 'How many sets for chest?'),
  ('c7c70000-0000-0000-0000-000000000001', 'assistant', 'About 10 to 12 a week.'),
  ('c7c70000-0000-0000-0000-000000000002', 'user', 'Other user');
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 2 from public.coach_messages), 'I read my own chat');
select pg_temp.expect_error($$insert into public.coach_messages (user_id, role, content) values (auth.uid(), 'assistant', 'fake coach')$$,
  'the app cannot write coach messages (no words in the coach''s mouth)');
select pg_temp.expect_error($$update public.coach_messages set content = 'x'$$, 'or edit them');
delete from public.coach_messages where user_id = 'c7c70000-0000-0000-0000-000000000002';
select pg_temp.logout();
select pg_temp.check((select count(*) = 3 from public.coach_messages), 'others'' messages can''t be deleted');
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
delete from public.coach_messages;
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 from public.coach_messages), 'clear chat removes only mine');

-- Summaries for Claude.
select pg_temp.login('c7c70000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.ai_plan_context(auth.uid(), 'full_gym')$$, 'clients cannot build the plan summary');
select pg_temp.expect_error($$select public.ai_coach_context(auth.uid())$$, 'or the coach summary');
select pg_temp.expect_error($$select public.admin_ai_feature_overrides()$$, 'or list overrides');
select pg_temp.as_service();
create temp table pc as select
  public.ai_plan_context('c7c70000-0000-0000-0000-000000000001', 'full_gym') as gym,
  public.ai_plan_context('c7c70000-0000-0000-0000-000000000001', 'home_dumbbells') as home,
  public.ai_plan_context('c7c70000-0000-0000-0000-000000000001', 'bodyweight') as bw,
  public.ai_plan_context('c7c70000-0000-0000-0000-000000000001', 'nonsense') as bad;
grant select on pc to service_role;
select pg_temp.check((select jsonb_array_length(gym -> 'prompt' -> 'exercises') > 50 from pc), 'full gym: the whole library (no cardio)');
select pg_temp.check((select gym -> 'prompt' -> 'exercises' ->> 0 like 'e1 % [%]' from pc), 'as short ids and names: "e1 Name [muscle]"');
select pg_temp.check((select (select count(*) from jsonb_object_keys(gym -> 'ids')) = jsonb_array_length(gym -> 'prompt' -> 'exercises') from pc),
  'every short id maps to a real exercise id');
select pg_temp.check((select not exists (
    select 1 from jsonb_each_text(home -> 'ids') i join public.exercises e on e.id = i.value::uuid
    where e.equipment not in ('dumbbell', 'bodyweight') and e.slug <> 'goblet_squat') and jsonb_array_length(home -> 'prompt' -> 'exercises') > 5 from pc),
  'home dumbbells: only dumbbell and bodyweight exercises');
select pg_temp.check((select not exists (
    select 1 from jsonb_each_text(bw -> 'ids') i join public.exercises e on e.id = i.value::uuid where e.equipment <> 'bodyweight')
  and jsonb_array_length(bw -> 'prompt' -> 'exercises') > 10 from pc), 'bodyweight only: only bodyweight exercises');
select pg_temp.check((select bw -> 'names' ?| array(select k from jsonb_each_text(bw -> 'names') x(k, v) where v = 'Squat (Bodyweight)')
  and (bw -> 'prompt' ->> 'exercises') like '%[quads]%' and (bw -> 'prompt' ->> 'exercises') like '%[shoulders]%' from pc),
  'including legs and shoulders');
select pg_temp.check((select (bw -> 'prompt' ->> 'exercises') not like '%Plank%' from pc), 'timed and cardio exercises are left out');
select pg_temp.check((select jsonb_array_length(bad -> 'prompt' -> 'exercises') = 0 from pc), 'unknown equipment: no exercises');
select pg_temp.check((select gym -> 'prompt' -> 'history' ->> 'sessions' = '1'
  and gym -> 'prompt' -> 'history' -> 'main_lifts' -> 0 ->> 'exercise' = 'Bench Press (Barbell)' from pc), 'with the training history');
select pg_temp.check((select gym -> 'prompt' -> 'athlete' ->> 'goal' = 'hypertrophy' from pc), 'and goal and experience');
select pg_temp.check((select (gym -> 'prompt')::text not like '%-0000-%' from pc), 'no real ids sent to Claude');
select pg_temp.check((select length((gym -> 'prompt')::text) < 9000 from pc), 'compact');

create temp table cc as select public.ai_coach_context('c7c70000-0000-0000-0000-000000000001') as c;
grant select on cc to service_role;
select pg_temp.check((select c -> 'recent_workouts' -> 0 ->> 'sets' like 'Bench Press (Barbell) 3x, top 65.0x8%' from cc),
  'coach: recent workouts in one line each');
select pg_temp.check((select c -> 'last_4_weeks' ->> 'sessions' = '1' and c ? 'today' and c -> 'athlete' ->> 'experience' = 'beginner' from cc),
  'with the last 4 weeks and the athlete');
select pg_temp.check((select length(c::text) < 4000 and c::text not like '%-0000-%' from cc), 'compact, no ids');
select pg_temp.check((select public.ai_coach_context('c7c70000-0000-0000-0000-000000000002') -> 'recent_workouts' = '[]'::jsonb),
  'a new user: no workouts yet');
select pg_temp.logout();

rollback;
\echo 'ai plans and coach tests passed'
