-- Stage 7: AI plan generator and AI coach chat.
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- Separate daily limits per feature (workout feedback 3, plans 2, coach
-- messages 15), per-feature admin overrides, programs (a saved plan's
-- templates, deleted together), coach chat history, and the compact
-- summaries the plan generator and the coach send to Claude.

-- ---------------------------------------------------------------------------
-- Settings: per-feature limits and output allowances.
-- ---------------------------------------------------------------------------
alter table public.ai_settings
  add column if not exists limit_workout_feedback integer,
  add column if not exists limit_plan integer not null default 2,
  add column if not exists limit_coach integer not null default 15,
  add column if not exists max_tokens_plan integer not null default 1500,
  add column if not exists max_tokens_coach integer not null default 400;
-- The Stage 6 daily limit becomes the workout feedback limit.
update public.ai_settings set limit_workout_feedback = daily_limit where limit_workout_feedback is null;
alter table public.ai_settings alter column limit_workout_feedback set default 3;
alter table public.ai_settings alter column limit_workout_feedback set not null;

alter table public.ai_settings drop constraint if exists ai_settings_feature_limits;
alter table public.ai_settings add constraint ai_settings_feature_limits check (
  limit_workout_feedback between 0 and 100 and limit_plan between 0 and 100 and limit_coach between 0 and 200
);
alter table public.ai_settings drop constraint if exists ai_settings_tokens_plan_coach;
alter table public.ai_settings add constraint ai_settings_tokens_plan_coach check (
  max_tokens_plan between 300 and 4000 and max_tokens_coach between 100 and 2000
);

-- Overrides per feature: (user, feature) instead of one per user.
alter table public.ai_limit_overrides add column if not exists function text not null default 'workout_feedback';
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_limit_overrides'::regclass and contype = 'p' and array_length(conkey, 1) = 1
  ) then
    alter table public.ai_limit_overrides drop constraint ai_limit_overrides_pkey;
    alter table public.ai_limit_overrides add constraint ai_limit_overrides_pkey primary key (user_id, function);
  end if;
end $$;
alter table public.ai_limit_overrides drop constraint if exists ai_limit_overrides_function;
alter table public.ai_limit_overrides add constraint ai_limit_overrides_function
  check (function in ('workout_feedback', 'plan', 'coach'));

-- ---------------------------------------------------------------------------
-- Programs: the templates of one saved plan, deleted together.
-- ---------------------------------------------------------------------------
create table if not exists public.user_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  weeks smallint,
  notes jsonb not null default '[]'::jsonb,
  source text not null default 'ai',
  created_at timestamptz not null default now(),

  constraint user_programs_name check (char_length(btrim(name)) between 1 and 60),
  constraint user_programs_description check (char_length(description) <= 600),
  constraint user_programs_weeks check (weeks between 1 and 16),
  constraint user_programs_source check (source in ('ai', 'manual'))
);
create index if not exists user_programs_user_idx on public.user_programs (user_id);
alter table public.user_programs enable row level security;
revoke all on public.user_programs from anon, authenticated;
grant select on public.user_programs to authenticated;
drop policy if exists "user_programs: read own" on public.user_programs;
create policy "user_programs: read own"
on public.user_programs for select
to authenticated
using (user_id = (select auth.uid()));

alter table public.templates add column if not exists program_id uuid references public.user_programs (id) on delete cascade;
create index if not exists templates_program_idx on public.templates (program_id);

-- ---------------------------------------------------------------------------
-- Coach chat. Written only by the coach Edge Function (so nobody can put
-- words in the coach's mouth); the owner reads and clears it.
-- ---------------------------------------------------------------------------
create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),

  constraint coach_messages_role check (role in ('user', 'assistant')),
  constraint coach_messages_length check (char_length(content) between 1 and 6000)
);
create index if not exists coach_messages_user_idx on public.coach_messages (user_id, created_at desc);
alter table public.coach_messages enable row level security;
revoke all on public.coach_messages from anon, authenticated;
grant select, delete on public.coach_messages to authenticated;
drop policy if exists "coach_messages: read own" on public.coach_messages;
create policy "coach_messages: read own"
on public.coach_messages for select
to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "coach_messages: clear own" on public.coach_messages;
create policy "coach_messages: clear own"
on public.coach_messages for delete
to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_programs, public.coach_messages to service_role;

-- Old one-limit versions; the new ones (below) take the feature. New names
-- where the result changed, so re-running the Stage 6 file can't clash.
drop function if exists public.admin_set_ai_override(uuid, integer);
drop function if exists public.admin_ai_overrides();

-- ---------------------------------------------------------------------------
-- Limits per feature
-- ---------------------------------------------------------------------------
create or replace function public._ai_feature_limit(p_user uuid, p_function text)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select o.daily_limit from public.ai_limit_overrides o where o.user_id = p_user and o.function = p_function),
    (select case p_function
              when 'plan' then s.limit_plan
              when 'coach' then s.limit_coach
              else s.limit_workout_feedback end
     from public.ai_settings s where s.id = 1)
  )
$$;

create or replace function public._ai_feature_used(p_user uuid, p_function text)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.ai_usage
  where user_id = p_user and function = p_function and day = public._ai_today() and counts_toward_limit
    and (status = 'ok' or (status = 'pending' and created_at > now() - interval '2 minutes'))
$$;

-- What the app shows. Top-level limit/used/remaining stay the workout
-- feedback numbers (Stage 6 screens); `features` has all three.
create or replace function public.ai_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.ai_settings := (select x from public.ai_settings x where id = 1);
  uid uuid := auth.uid();
  features jsonb := '{}'::jsonb;
  f text;
  lim integer;
  used integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  foreach f in array array['workout_feedback', 'plan', 'coach'] loop
    lim := public._ai_feature_limit(uid, f);
    used := public._ai_feature_used(uid, f);
    features := features || jsonb_build_object(f, jsonb_build_object(
      'limit', lim, 'used', used, 'remaining', greatest(lim - used, 0)));
  end loop;
  return jsonb_build_object(
    'enabled', s.enabled,
    'paused_for_budget', public._ai_spent_today() >= s.daily_budget_usd,
    'limit', features -> 'workout_feedback' -> 'limit',
    'used_today', features -> 'workout_feedback' -> 'used',
    'remaining', features -> 'workout_feedback' -> 'remaining',
    'features', features
  );
end $$;

-- Same contract as Stage 6, with the feature's own limit and allowances.
create or replace function public.ai_reserve(
  p_user uuid,
  p_function text,
  p_ref text,
  p_counts boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings;
  today date := public._ai_today();
  max_tokens integer;
  input_estimate integer;
  estimate numeric;
  lim integer;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ai_reserve'));
  select * into s from public.ai_settings where id = 1;
  max_tokens := case p_function
    when 'weekly_report' then s.max_tokens_weekly
    when 'plan' then s.max_tokens_plan
    when 'coach' then s.max_tokens_coach
    else s.max_tokens_feedback end;
  -- Worst-case input per call (a plan carries the exercise list).
  input_estimate := case p_function when 'plan' then 5000 when 'coach' then 3500 else 2500 end;
  estimate := (input_estimate * s.price_input + max_tokens * s.price_output) / 1000000;

  if not s.enabled then
    insert into public.ai_usage (user_id, function, ref_id, status, counts_toward_limit, day, finished_at)
    values (p_user, p_function, p_ref, 'blocked_disabled', false, today, now());
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  if exists (
    select 1 from public.ai_usage
    where user_id = p_user and function = p_function and ref_id is not distinct from p_ref
      and status = 'pending' and created_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'in_progress');
  end if;

  if p_counts then
    lim := public._ai_feature_limit(p_user, p_function);
    if public._ai_feature_used(p_user, p_function) >= lim then
      insert into public.ai_usage (user_id, function, ref_id, status, counts_toward_limit, day, finished_at)
      values (p_user, p_function, p_ref, 'blocked_limit', false, today, now());
      return jsonb_build_object('ok', false, 'reason', 'limit', 'limit', lim);
    end if;
  end if;

  if public._ai_spent_today() + estimate > s.daily_budget_usd then
    insert into public.ai_usage (user_id, function, ref_id, status, counts_toward_limit, day, finished_at)
    values (p_user, p_function, p_ref, 'blocked_budget', false, today, now());
    return jsonb_build_object('ok', false, 'reason', 'budget');
  end if;

  insert into public.ai_usage (user_id, function, ref_id, status, counts_toward_limit, model, estimated_cost_usd, day)
  values (p_user, p_function, p_ref, 'pending', p_counts, s.model, estimate, today)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'model', s.model, 'max_tokens', max_tokens);
end $$;

drop function if exists public._ai_limit_for(uuid);
drop function if exists public._ai_used_today(uuid);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_ai_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before jsonb;
  allowed text[] := array['enabled', 'daily_budget_usd', 'model', 'limit_workout_feedback', 'limit_plan',
                          'limit_coach', 'max_tokens_feedback', 'max_tokens_weekly', 'max_tokens_plan',
                          'max_tokens_coach', 'price_input', 'price_output', 'price_cache_write',
                          'price_cache_read', 'daily_limit'];
  k text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not k = any(allowed) then raise exception 'unknown setting %', k using errcode = '22023'; end if;
  end loop;
  select to_jsonb(s) into before from public.ai_settings s where id = 1;
  update public.ai_settings set
    enabled = coalesce((p_changes ->> 'enabled')::boolean, enabled),
    daily_budget_usd = coalesce((p_changes ->> 'daily_budget_usd')::numeric, daily_budget_usd),
    model = coalesce(nullif(btrim(p_changes ->> 'model'), ''), model),
    -- daily_limit is the Stage 6 name of the workout feedback limit.
    limit_workout_feedback = coalesce((p_changes ->> 'limit_workout_feedback')::integer,
                                      (p_changes ->> 'daily_limit')::integer, limit_workout_feedback),
    daily_limit = coalesce((p_changes ->> 'limit_workout_feedback')::integer,
                           (p_changes ->> 'daily_limit')::integer, daily_limit),
    limit_plan = coalesce((p_changes ->> 'limit_plan')::integer, limit_plan),
    limit_coach = coalesce((p_changes ->> 'limit_coach')::integer, limit_coach),
    max_tokens_feedback = coalesce((p_changes ->> 'max_tokens_feedback')::integer, max_tokens_feedback),
    max_tokens_weekly = coalesce((p_changes ->> 'max_tokens_weekly')::integer, max_tokens_weekly),
    max_tokens_plan = coalesce((p_changes ->> 'max_tokens_plan')::integer, max_tokens_plan),
    max_tokens_coach = coalesce((p_changes ->> 'max_tokens_coach')::integer, max_tokens_coach),
    price_input = coalesce((p_changes ->> 'price_input')::numeric, price_input),
    price_output = coalesce((p_changes ->> 'price_output')::numeric, price_output),
    price_cache_write = coalesce((p_changes ->> 'price_cache_write')::numeric, price_cache_write),
    price_cache_read = coalesce((p_changes ->> 'price_cache_read')::numeric, price_cache_read),
    updated_at = now()
  where id = 1;
  perform public.log_admin_action('ai.settings', 'ai_settings', '1', jsonb_build_object(
    'changes', p_changes,
    'before', (select jsonb_object_agg(key, before -> key) from jsonb_object_keys(p_changes) key)
  ));
  return public.admin_ai_settings();
end $$;

create or replace function public.admin_set_ai_override(
  p_user uuid,
  p_limit integer,
  p_function text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_function not in ('workout_feedback', 'plan', 'coach') then
    raise exception 'unknown feature %', p_function using errcode = '22023';
  end if;
  if p_limit is null then
    delete from public.ai_limit_overrides where user_id = p_user and function = p_function;
  else
    insert into public.ai_limit_overrides (user_id, function, daily_limit) values (p_user, p_function, p_limit)
    on conflict (user_id, function) do update set daily_limit = excluded.daily_limit, updated_at = now();
  end if;
  perform public.log_admin_action('ai.override', 'user', p_user::text,
    jsonb_build_object('function', p_function, 'daily_limit', p_limit));
end $$;

create or replace function public.admin_ai_feature_overrides()
returns table (user_id uuid, username text, display_name text, function text, daily_limit integer, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select o.user_id, p.username, p.display_name, o.function, o.daily_limit, o.updated_at
    from public.ai_limit_overrides o left join public.profiles p on p.id = o.user_id
    order by p.username, o.function;
end $$;

-- ---------------------------------------------------------------------------
-- Plans: save as a program (templates), delete a program at once.
-- ---------------------------------------------------------------------------

-- p_program: {name, description, weeks, notes[]}; p_days: [{p_template: {name,
-- notes}, p_exercises: [...]}], the same shape as save_template. Exercises
-- are checked by write_template (global or the user's own).
create or replace function public.save_ai_plan(p_program jsonb, p_days jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  program_id uuid;
  day jsonb;
  ord bigint;
  template_id uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) not between 1 and 7 then
    raise exception 'a plan needs 1 to 7 days' using errcode = '22023';
  end if;
  if (select count(*) from public.user_programs where user_id = uid) >= 20 then
    raise exception 'you can keep at most 20 programs' using errcode = '22023';
  end if;
  insert into public.user_programs (user_id, name, description, weeks, notes)
  values (
    uid,
    btrim(p_program ->> 'name'),
    nullif(btrim(p_program ->> 'description'), ''),
    (p_program ->> 'weeks')::smallint,
    coalesce(p_program -> 'notes', '[]'::jsonb)
  )
  returning id into program_id;

  for day, ord in select x, n from jsonb_array_elements(p_days) with ordinality as t(x, n) loop
    template_id := gen_random_uuid();
    insert into public.templates (id, owner_id, name, program_id, position)
    values (template_id, uid, coalesce(nullif(btrim(day -> 'p_template' ->> 'name'), ''), 'Day ' || ord), program_id, (ord - 1)::smallint);
    perform public.write_template(
      template_id, uid,
      (day -> 'p_template') - 'program' - 'position' || jsonb_build_object('position', ord - 1),
      day -> 'p_exercises'
    );
  end loop;
  return program_id;
end $$;

-- Deletes a program and all its templates (past workouts are kept). Leaves
-- tombstones so an offline edit of one of its templates can't bring it back.
create or replace function public.delete_program(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t uuid;
begin
  if not exists (select 1 from public.user_programs where id = p_id and user_id = uid) then
    raise exception 'program % not found', p_id using errcode = 'P0002';
  end if;
  for t in select id from public.templates where program_id = p_id loop
    perform public._tombstone('template', t, uid, now());
  end loop;
  delete from public.user_programs where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- A few bodyweight leg and shoulder exercises, so "bodyweight only" plans
-- can train every muscle group. Skips rows that already exist.
-- ---------------------------------------------------------------------------
insert into public.exercises (slug, name, primary_muscle, secondary_muscles, equipment, type, default_rest_seconds, instructions)
values
  ('bodyweight_squat', 'Squat (Bodyweight)', 'quads', array['glutes']::public.muscle_group[], 'bodyweight', 'bodyweight', 60,
   'Feet shoulder-width apart, arms in front. Sit back and down until thighs are at least parallel, knees over toes, chest up. Stand back up.'),
  ('bodyweight_reverse_lunge', 'Reverse Lunge (Bodyweight)', 'quads', array['glutes', 'hamstrings']::public.muscle_group[], 'bodyweight', 'bodyweight', 60,
   'Step one foot back and lower until both knees are bent about 90°, front knee over the ankle. Push through the front heel to stand. Alternate legs.'),
  ('bodyweight_split_squat', 'Bulgarian Split Squat (Bodyweight)', 'quads', array['glutes']::public.muscle_group[], 'bodyweight', 'bodyweight', 60,
   'Rear foot on a bench or chair behind you. Lower until the front thigh is about parallel, torso upright, then push back up. Do all reps, then switch legs.'),
  ('pike_push_up', 'Pike Push-up', 'shoulders', array['triceps']::public.muscle_group[], 'bodyweight', 'bodyweight', 90,
   'Hands and feet on the floor, hips high so your body makes an upside-down V. Bend the elbows to bring your head toward the floor, then press back up.'),
  ('bodyweight_calf_raise', 'Calf Raise (Bodyweight)', 'calves', '{}'::public.muscle_group[], 'bodyweight', 'bodyweight', 45,
   'Balls of your feet on a step, heels hanging off. Rise as high as you can, pause, then lower the heels below the step. Hold a wall for balance.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Summaries for Claude (service role only)
-- ---------------------------------------------------------------------------

-- Training history in a few lines: weekly rhythm, main lifts, muscle split.
create or replace function public._ai_history(p_user uuid, units text, p_weeks integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with w as (
    select * from public.workouts where user_id = p_user and started_at > now() - make_interval(weeks => p_weeks)
  ),
  s as (
    select x.*, e.name, e.primary_muscle::text as muscle
    from public.workout_sets x join w on w.id = x.workout_id join public.exercises e on e.id = x.exercise_id
    where x.set_type <> 'warmup'
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'weeks', p_weeks,
    'sessions', (select count(*) from w),
    'avg_sessions_per_week', round((select count(*) from w)::numeric / p_weeks, 1),
    'avg_minutes', (select round(avg(duration_seconds) / 60.0) from w),
    'main_lifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'exercise', t.name, 'sets', t.sets,
          'best_e1rm', public._ai_w(t.e1rm, units), 'best_set', t.best
        ) order by t.sets desc), '[]'::jsonb)
      from (
        select name, count(*) as sets,
          max(weight_kg * (1 + reps / 30.0)) filter (where weight_kg > 0 and reps between 1 and 12) as e1rm,
          (array_agg(public._ai_set_text(weight_kg, reps, duration_seconds, distance_m, units)
             order by weight_kg desc nulls last, reps desc nulls last))[1] as best
        from s group by name order by count(*) desc limit 8
      ) t
    ),
    'sets_per_week_by_muscle', (
      select coalesce(jsonb_object_agg(muscle, round(n::numeric / p_weeks, 1)), '{}'::jsonb)
      from (select muscle, count(*) as n from s group by muscle) m
    )
  ))
$$;

-- Plan generator input: athlete, history, and the exercises allowed for the
-- chosen equipment as short ids (e1, e2…). `ids` and `names` map them back
-- to real exercises (kept server-side, not sent to Claude).
create or replace function public.ai_plan_context(p_user uuid, p_equipment text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  units text := coalesce((select units::text from public.profiles where id = p_user), 'kg');
  allowed text[];
  list jsonb;
  ids jsonb;
  names jsonb;
begin
  allowed := case p_equipment
    when 'bodyweight' then array['bodyweight']
    when 'home_dumbbells' then array['dumbbell', 'bodyweight']
    when 'full_gym' then null
    else array['__none__'] end;
  with ex as (
    select e.id, e.name, e.primary_muscle::text as muscle,
      'e' || row_number() over (order by e.primary_muscle, e.name) as short
    from public.exercises e
    where not e.is_hidden and (e.owner_id is null or e.owner_id = p_user)
      and e.type not in ('cardio', 'timed')
      -- A goblet squat works with one dumbbell too.
      and (allowed is null or e.equipment::text = any(allowed) or (p_equipment = 'home_dumbbells' and e.slug = 'goblet_squat'))
  )
  select coalesce(jsonb_agg(ex.short || ' ' || ex.name || ' [' || ex.muscle || ']' order by ex.short), '[]'::jsonb),
         coalesce(jsonb_object_agg(ex.short, ex.id), '{}'::jsonb),
         coalesce(jsonb_object_agg(ex.short, ex.name), '{}'::jsonb)
  into list, ids, names from ex;

  return jsonb_build_object(
    'prompt', jsonb_build_object(
      'athlete', public._ai_athlete(p_user),
      'history', public._ai_history(p_user, units, 8),
      'exercises', list
    ),
    'ids', ids,
    'names', names
  );
end $$;

-- Coach input: athlete, last 4 weeks, the last 5 workouts in one line each,
-- recent PRs, this week's muscle split.
create or replace function public.ai_coach_context(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  units text := coalesce((select units::text from public.profiles where id = p_user), 'kg');
  tz text := (select timezone from public.ai_settings where id = 1);
  week_from timestamptz := (public._ai_week_start(public._ai_today())::timestamp) at time zone tz;
begin
  return jsonb_strip_nulls(jsonb_build_object(
    'today', to_char(now() at time zone tz, 'Dy YYYY-MM-DD'),
    'athlete', public._ai_athlete(p_user),
    'last_4_weeks', public._ai_history(p_user, units, 4),
    'recent_workouts', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'date', to_char(w.started_at at time zone tz, 'Dy MM-DD'),
          'name', w.name,
          'minutes', round(w.duration_seconds / 60.0),
          'sets', (
            select string_agg(x.line, '; ' order by x.ord)
            from (
              select min(s.exercise_order) as ord,
                e.name || ' ' || count(*) || 'x, top ' ||
                (array_agg(public._ai_set_text(s.weight_kg, s.reps, s.duration_seconds, s.distance_m, units)
                   order by s.weight_kg desc nulls last, s.reps desc nulls last))[1] as line
              from public.workout_sets s join public.exercises e on e.id = s.exercise_id
              where s.workout_id = w.id and s.set_type <> 'warmup'
              group by e.name
              order by min(s.exercise_order)
              limit 8
            ) x
          ),
          'notes', left(w.notes, 200)
        ) order by w.started_at desc), '[]'::jsonb)
      from (select * from public.workouts where user_id = p_user order by started_at desc limit 5) w
    ),
    'records_last_30_days', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'exercise', e.name, 'record', r.record_type::text,
          'value', case when r.record_type in ('heaviest_weight', 'best_e1rm', 'session_volume')
                        then public._ai_w(r.value, units) else r.value end
        )), '[]'::jsonb)
      from public.personal_records r join public.exercises e on e.id = r.exercise_id
      where r.user_id = p_user and r.achieved_at > now() - interval '30 days'
        and r.record_type in ('heaviest_weight', 'best_e1rm') and r.previous_value is not null
    ),
    'this_week_sets_by_muscle', public._ai_muscle_sets(p_user, week_from, week_from + interval '7 days')
  ));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._ai_feature_limit(uuid, text)', 'public._ai_feature_used(uuid, text)',
    'public._ai_history(uuid, text, integer)', 'public.ai_plan_context(uuid, text)',
    'public.ai_coach_context(uuid)', 'public.ai_reserve(uuid, text, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.ai_plan_context(uuid, text)', 'public.ai_coach_context(uuid)',
    'public.ai_reserve(uuid, text, text, boolean)'
  ] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.ai_status()', 'public.admin_update_ai_settings(jsonb)',
    'public.admin_set_ai_override(uuid, integer, text)', 'public.admin_ai_feature_overrides()',
    'public.save_ai_plan(jsonb, jsonb)', 'public.delete_program(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
