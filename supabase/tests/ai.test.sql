-- AI: limits are atomic and enforced here, kill switch, spending cap, cost per
-- call, admin changes logged, users only see their own usage and feedback,
-- and the summary sent to Claude is compact and built from real data.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('a1a10000-0000-0000-0000-000000000001', 'ai-a@test.dev');
select pg_temp.new_user('a1a10000-0000-0000-0000-000000000002', 'ai-b@test.dev');
select pg_temp.new_user('a1a10000-0000-0000-0000-000000000003', 'ai-admin@test.dev');
update public.profiles set username = 'ai_a', goal = 'strength', experience_level = 'intermediate',
  training_days_per_week = 3, units = 'kg', bodyweight_kg = 80
where id = 'a1a10000-0000-0000-0000-000000000001';
update public.profiles set username = 'ai_b' where id = 'a1a10000-0000-0000-0000-000000000002';
update public.profiles set username = 'ai_admin', role = 'admin' where id = 'a1a10000-0000-0000-0000-000000000003';

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
end $$;
create function pg_temp.reserve(u text, ref text, counts boolean default true) returns jsonb language sql as $$
  select public.ai_reserve(u::uuid, 'workout_feedback', ref, counts)
$$;
create function pg_temp.ok(u text, ref text) returns void language plpgsql as $$
declare r jsonb := pg_temp.reserve(u, ref);
begin
  if not (r ->> 'ok')::boolean then raise exception 'expected ok, got %', r; end if;
  perform public.ai_finish((r ->> 'id')::uuid, 'ok', 900, 300, 0, 600);
end $$;

-- Clients can't reserve, finish, or read the data summaries themselves.
select pg_temp.login('a1a10000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.ai_reserve(auth.uid(), 'workout_feedback', 'x', true)$$, 'clients cannot reserve AI calls');
select pg_temp.expect_error($$select public.ai_finish(gen_random_uuid(), 'ok')$$, 'or report them');
select pg_temp.expect_error($$select public.ai_workout_context(auth.uid(), gen_random_uuid())$$, 'or build Claude context');
select pg_temp.expect_error($$select * from public.ai_settings$$, 'or read settings directly');
select pg_temp.expect_error($$insert into public.ai_feedback (user_id, kind, week_start, content, model) values (auth.uid(), 'weekly', '2026-10-26', '{}', 'x')$$,
  'or write feedback');
select pg_temp.check((select public.ai_status() = '{"enabled": true, "paused_for_budget": false, "limit": 3, "used_today": 0, "remaining": 3}'::jsonb),
  'status: 3 calls a day by default');

-- Daily limit: 3 calls, the 4th is refused (and logged).
select pg_temp.as_service();
select pg_temp.ok('a1a10000-0000-0000-0000-000000000001', 'w1');
select pg_temp.ok('a1a10000-0000-0000-0000-000000000001', 'w2');
select pg_temp.ok('a1a10000-0000-0000-0000-000000000001', 'w3');
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000001', 'w4') = '{"ok": false, "limit": 3, "reason": "limit"}'::jsonb),
  'the 4th call of the day is blocked');
select pg_temp.check((select count(*) = 1 from public.ai_usage where status = 'blocked_limit'), 'and logged as blocked');
select pg_temp.check((select (pg_temp.reserve('a1a10000-0000-0000-0000-000000000002', 'w9') ->> 'ok')::boolean), 'another user still has calls');
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000002', 'w9') ->> 'reason' = 'in_progress'),
  'a second tap while the first call runs is refused (no double call)');

-- A call that is still running counts (two quick taps on different workouts).
select pg_temp.reserve('a1a10000-0000-0000-0000-000000000002', 'w10');
select pg_temp.check((select (pg_temp.reserve('a1a10000-0000-0000-0000-000000000002', 'w11') ->> 'ok')::boolean), '3rd running call ok');
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000002', 'w12') ->> 'reason' = 'limit'),
  'running calls count toward the limit');

-- A failed call doesn't use up a call.
update public.ai_usage set status = 'error', counts_toward_limit = false where user_id = 'a1a10000-0000-0000-0000-000000000002' and ref_id = 'w11';
select pg_temp.check((select (pg_temp.reserve('a1a10000-0000-0000-0000-000000000002', 'w12') ->> 'ok')::boolean), 'after an error the call is available again');
select pg_temp.check((select public.ai_finish(id, 'error', 100, 0, 0, 0, 2, 'timeout') = 0.00001 from public.ai_usage
  where user_id = 'a1a10000-0000-0000-0000-000000000002' and ref_id = 'w12' and status = 'pending'),
  'a failed call still logs its cost');
select pg_temp.check((select not counts_toward_limit and attempts = 2 and error = 'timeout' from public.ai_usage
  where user_id = 'a1a10000-0000-0000-0000-000000000002' and ref_id = 'w12' and status = 'error'), 'but does not count toward the limit');

-- Weekly reports don't use the user's daily calls.
select pg_temp.check((select (public.ai_reserve('a1a10000-0000-0000-0000-000000000001', 'weekly_report', '2026-10-19', false) ->> 'ok')::boolean),
  'a weekly report goes through even when the daily calls are used up');
select pg_temp.check((select public.ai_reserve('a1a10000-0000-0000-0000-000000000001', 'weekly_report', '2026-10-12', false) ->> 'max_tokens' = '700'),
  'weekly reports get 700 output tokens');
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000003', 'x') ->> 'max_tokens' = '400'
  and pg_temp.reserve('a1a10000-0000-0000-0000-000000000003', 'y') ->> 'model' = 'claude-haiku-5-5'),
  'workout feedback gets 400, and the model comes from settings');

-- Cost from token counts and the prices in settings.
select pg_temp.check((select cost_usd = 0.000246 from public.ai_usage where user_id = 'a1a10000-0000-0000-0000-000000000001' and ref_id = 'w1'),
  'cost: 900 in × $0.10 + 300 out × $0.50 + 600 cache reads × $0.01 per M = $0.000246');

-- Admin: settings, overrides, logged; others can't.
select pg_temp.login('a1a10000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.admin_update_ai_settings('{"daily_limit": 50}')$$, 'non-admins cannot change AI settings');
select pg_temp.expect_error($$select public.admin_set_ai_override(auth.uid(), 99)$$, 'or give themselves more calls');
select pg_temp.expect_error($$select public.admin_ai_usage(30)$$, 'or see the dashboard');
select pg_temp.login('a1a10000-0000-0000-0000-000000000003');
select public.admin_set_ai_override('a1a10000-0000-0000-0000-000000000001', 5);
select pg_temp.check((select count(*) = 1 from public.admin_ai_overrides() where username = 'ai_a' and daily_limit = 5), 'admin sets a per-user override');
select pg_temp.check((select count(*) = 1 from public.admin_find_users('ai_') where email = 'ai-a@test.dev'), 'admin finds users by name');
select pg_temp.expect_error($$select public.admin_update_ai_settings('{"model": "gpt-4"}')$$, 'only Claude model ids');
select pg_temp.expect_error($$select public.admin_update_ai_settings('{"functions_url": "https://evil"}')$$, 'unknown settings rejected');
select pg_temp.check((select (public.admin_update_ai_settings('{"daily_budget_usd": 0.75}') ->> 'daily_budget_usd')::numeric = 0.75), 'admin changes the spending cap');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.admin_actions where action in ('ai.override', 'ai.settings')
  and admin_id = 'a1a10000-0000-0000-0000-000000000003'), 'both changes are in admin_actions');
select pg_temp.check((select (details -> 'before' ->> 'daily_budget_usd')::numeric = 0.5 from public.admin_actions where action = 'ai.settings'),
  'with the value before the change');
select pg_temp.as_service();
select pg_temp.check((select (pg_temp.reserve('a1a10000-0000-0000-0000-000000000001', 'w5') ->> 'ok')::boolean), 'override: 5 calls instead of 3');
select pg_temp.login('a1a10000-0000-0000-0000-000000000003');
select public.admin_set_ai_override('a1a10000-0000-0000-0000-000000000001', 0);
select pg_temp.as_service();
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000001', 'w6') ->> 'reason' = 'limit'), 'override 0 blocks AI for that user');

-- Kill switch: off for everyone, instantly.
select pg_temp.login('a1a10000-0000-0000-0000-000000000003');
select public.admin_update_ai_settings('{"enabled": false}');
select pg_temp.as_service();
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000003', 'k1') ->> 'reason' = 'disabled'), 'kill switch blocks every call');
select pg_temp.check((select public.ai_reserve('a1a10000-0000-0000-0000-000000000002', 'weekly_report', 'k2', false) ->> 'reason' = 'disabled'),
  'including weekly reports');
select pg_temp.login('a1a10000-0000-0000-0000-000000000002');
select pg_temp.check((select (public.ai_status() ->> 'enabled')::boolean = false), 'the app sees AI is off');

-- Spending cap: once today's cost reaches it, AI pauses for everyone.
select pg_temp.login('a1a10000-0000-0000-0000-000000000003');
select public.admin_update_ai_settings('{"enabled": true, "daily_budget_usd": 0.01}');
select public.admin_set_ai_override('a1a10000-0000-0000-0000-000000000003', 20); -- so the cap, not the limit, is what stops it
select pg_temp.as_service();
select pg_temp.check((select (pg_temp.reserve('a1a10000-0000-0000-0000-000000000003', 'c1') ->> 'ok')::boolean), 'under the cap: ok');
select public.ai_finish(id, 'ok', 40000, 12000) from public.ai_usage where ref_id = 'c1' and status = 'pending';
select pg_temp.check((select pg_temp.reserve('a1a10000-0000-0000-0000-000000000003', 'c2') ->> 'reason' = 'budget'), 'over the cap: paused');
select pg_temp.check((select public.ai_reserve('a1a10000-0000-0000-0000-000000000002', 'weekly_report', 'c3', false) ->> 'reason' = 'budget'),
  'for everyone, weekly reports too');
select pg_temp.login('a1a10000-0000-0000-0000-000000000002');
select pg_temp.check((select (public.ai_status() ->> 'paused_for_budget')::boolean), 'the app sees AI is paused for today');
select pg_temp.as_service();
update public.ai_usage set day = day - 1;
select pg_temp.check((select (pg_temp.reserve('a1a10000-0000-0000-0000-000000000003', 'c4') ->> 'ok')::boolean), 'the next day it works again');

-- Dashboard.
select pg_temp.login('a1a10000-0000-0000-0000-000000000003');
select pg_temp.check((select jsonb_array_length(public.admin_ai_usage(30) -> 'days') = 30), 'dashboard: 30 days');
select pg_temp.check((select (public.admin_ai_usage(30) -> 'totals' ->> 'errors')::int = 2
  and (public.admin_ai_usage(30) -> 'totals' ->> 'error_rate')::numeric > 0), 'with errors and the error rate');
select pg_temp.check((select public.admin_ai_usage(30) -> 'top_users' -> 0 ->> 'username' = 'ai_admin'), 'top users by cost');

-- Data summary for Claude: from real sets, compact.
select pg_temp.login('a1a10000-0000-0000-0000-000000000001');
create function pg_temp.bench() returns uuid language sql as $$ select id from public.exercises where slug = 'barbell_bench_press' $$;
create function pg_temp.session(wid text, at timestamptz, weight numeric, notes text default null) returns void language sql as $$
  select null::void from (select public.save_workout(
    jsonb_build_object('id', wid, 'name', 'Push', 'started_at', at, 'ended_at', at + interval '1 hour', 'notes', notes),
    (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', pg_temp.bench(), 'exercise_order', 0,
       'set_order', n, 'weight_kg', weight, 'reps', 5, 'set_type', case when n = 0 then 'warmup' else 'normal' end))
     from generate_series(0, 3) n))) x
$$;
select pg_temp.session('b1b10000-0000-0000-0000-000000000001', now() - interval '14 days', 80);
select pg_temp.session('b1b10000-0000-0000-0000-000000000002', now() - interval '7 days', 85);
select pg_temp.session('b1b10000-0000-0000-0000-000000000003', now() - interval '1 hour', 90, 'Left shoulder hurt on the last set');
select pg_temp.as_service();
create temp table ctx as select public.ai_workout_context('a1a10000-0000-0000-0000-000000000001', 'b1b10000-0000-0000-0000-000000000003') as c;
grant select on ctx to authenticated;
select pg_temp.check((select c -> 'workout' -> 'exercises' -> 0 ->> 'top_set' = '90.0x5' and (c -> 'workout' -> 'exercises' -> 0 ->> 'working_sets')::int = 3 from ctx),
  'workout: top set and working sets (warm-up not counted)');
select pg_temp.check((select (c -> 'workout' -> 'exercises' -> 0 ->> 'best_e1rm')::numeric = 105.0 from ctx), 'best e1RM (Epley)');
select pg_temp.check((select jsonb_array_length(c -> 'previous_sessions' -> 0 -> 'sessions') = 2
  and c -> 'previous_sessions' -> 0 -> 'sessions' -> 0 ->> 'top_set' = '85.0x5' from ctx), 'compared with the previous sessions, newest first');
select pg_temp.check((select c -> 'new_records' @> '[{"record": "heaviest_weight", "value": 90.0, "previous": 85.0}]' from ctx), 'new PRs included');
select pg_temp.check((select c -> 'workout' ->> 'notes' like '%shoulder hurt%' from ctx), 'notes included (pain → see a professional)');
select pg_temp.check((select (c -> 'this_week' -> 'sets_by_muscle' ->> 'chest')::numeric >= 3 from ctx), 'muscle balance this week');
select pg_temp.check((select jsonb_array_length(c -> 'previous_weeks') = 4 from ctx), 'and the 4 weeks before (volume jumps)');
select pg_temp.check((select c -> 'athlete' ->> 'goal' = 'strength' from ctx), 'goal and experience');
select pg_temp.check((select length(c::text) < 3000 from ctx), 'compact: a summary, not raw rows');
select pg_temp.check((select c::text not like '%a1a10000%' and c::text not like '%b1b10000%' from ctx), 'no ids sent to Claude');
select pg_temp.check((select public.ai_workout_context('a1a10000-0000-0000-0000-000000000002', 'b1b10000-0000-0000-0000-000000000003') is null),
  'another user''s workout gives no context');
update public.profiles set units = 'lbs' where id = 'a1a10000-0000-0000-0000-000000000001';
select pg_temp.check((select public.ai_workout_context('a1a10000-0000-0000-0000-000000000001', 'b1b10000-0000-0000-0000-000000000003')
  -> 'workout' -> 'exercises' -> 0 ->> 'top_set' = '198.4x5'), 'weights in the user''s unit (lbs)');
update public.profiles set units = 'kg' where id = 'a1a10000-0000-0000-0000-000000000001';

-- Weekly: who gets a report, the week summary, saving.
select pg_temp.logout();
create temp table wk as select public._ai_week_start(public._ai_today()) as ws;
grant select on wk to service_role, authenticated;
select pg_temp.as_service();
select pg_temp.check((select 'a1a10000-0000-0000-0000-000000000001'::uuid in (select public.ai_weekly_candidates(ws)) from wk), 'trained this week: gets a report');
select pg_temp.check((select 'a1a10000-0000-0000-0000-000000000002'::uuid not in (select public.ai_weekly_candidates(ws)) from wk), 'didn''t train: no report');
select pg_temp.check((select public.ai_week_context('a1a10000-0000-0000-0000-000000000002', ws) is null from wk), 'and no context');
select pg_temp.check((select jsonb_array_length(public.ai_week_context('a1a10000-0000-0000-0000-000000000001', ws) -> 'week' -> 'sessions') >= 1 from wk),
  'week summary lists the sessions');
select public.ai_save_feedback('a1a10000-0000-0000-0000-000000000001', 'weekly', null, ws, '{"summary": "v1"}', 'claude-haiku-5-5') from wk;
select public.ai_save_feedback('a1a10000-0000-0000-0000-000000000001', 'weekly', null, ws, '{"summary": "v2"}', 'claude-haiku-5-5') from wk;
select pg_temp.check((select count(*) = 1 and min(content ->> 'summary') = 'v2' from public.ai_feedback where kind = 'weekly'), 'saving again replaces the report');
select pg_temp.check((select 'a1a10000-0000-0000-0000-000000000001'::uuid not in (select public.ai_weekly_candidates(ws)) from wk), 'and it isn''t generated twice');
select public.ai_save_feedback('a1a10000-0000-0000-0000-000000000001', 'workout', 'b1b10000-0000-0000-0000-000000000003', null, '{"summary": "x"}', 'claude-haiku-5-5');
select pg_temp.check((select source_updated_at is not null from public.ai_feedback where kind = 'workout'), 'workout feedback remembers the workout version');

-- Each user sees only their own.
select pg_temp.login('a1a10000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) = 0 from public.ai_feedback), 'others cannot read my feedback');
select pg_temp.check((select count(*) = 0 from public.ai_usage where user_id = 'a1a10000-0000-0000-0000-000000000001'), 'or my usage');
select public.ai_mark_seen(id) from public.ai_feedback;
select pg_temp.login('a1a10000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) = 2 from public.ai_feedback), 'I read my feedback');
select pg_temp.check((select count(*) > 0 from public.ai_usage), 'and my usage');
select public.ai_mark_seen(id) from public.ai_feedback where kind = 'weekly';
select pg_temp.check((select seen_at is not null from public.ai_feedback where kind = 'weekly'), 'mark a report as seen');

-- Push tokens.
select public.save_push_token('ExponentPushToken[abc123]');
select pg_temp.expect_error($$select public.save_push_token('not-a-token')$$, 'only Expo push tokens');
select pg_temp.login('a1a10000-0000-0000-0000-000000000002');
select public.save_push_token('ExponentPushToken[abc123]');
select pg_temp.logout();
select pg_temp.check((select user_id = 'a1a10000-0000-0000-0000-000000000002' from public.push_tokens), 'a phone that changes account moves with it');

-- Cron runs: the token works once, within the hour.
insert into public.ai_cron_runs (id, token_hash, week_start)
values ('c0c00000-0000-0000-0000-000000000001', extensions.digest('secret-token', 'sha256'), '2026-10-19');
select pg_temp.as_service();
select pg_temp.check((select public.ai_claim_weekly_run('c0c00000-0000-0000-0000-000000000001', 'secret-token') = '2026-10-19'), 'cron token claims the run');
select pg_temp.expect_error($$select public.ai_claim_weekly_run('c0c00000-0000-0000-0000-000000000001', 'secret-token')$$, 'only once');
select pg_temp.expect_error($$select public.ai_claim_weekly_run('c0c00000-0000-0000-0000-000000000001', 'guess')$$, 'not with a wrong token');
select pg_temp.login('a1a10000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.ai_claim_weekly_run('c0c00000-0000-0000-0000-000000000001', 'secret-token')$$, 'clients cannot claim runs');
select pg_temp.expect_error($$select public.ai_start_weekly_run()$$, 'or start them');
select pg_temp.logout();

rollback;
\echo 'ai tests passed'
