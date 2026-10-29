-- Stage 6: Claude feedback (after a workout, and a weekly report).
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- Everything that costs money is decided here, in the database: the kill
-- switch, the per-user daily limit (with admin overrides), the global daily
-- spending cap, and the cost of each call. The Edge Functions reserve a call
-- with ai_reserve() before talking to Claude and report back with ai_finish().
-- The data sent to Claude is a compact summary built by ai_workout_context() /
-- ai_week_context(), never raw rows.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings: one row. Admins change it from the app (logged).
-- ---------------------------------------------------------------------------
create table if not exists public.ai_settings (
  id smallint primary key default 1,
  enabled boolean not null default true,
  daily_limit integer not null default 3,
  daily_budget_usd numeric(10, 4) not null default 0.50,
  model text not null default 'claude-haiku-5-5',
  -- USD per million tokens (Claude Haiku 5.5, prompts up to 100K tokens).
  price_input numeric(10, 4) not null default 0.10,
  price_output numeric(10, 4) not null default 0.50,
  price_cache_write numeric(10, 4) not null default 0.125,
  price_cache_read numeric(10, 4) not null default 0.01,
  max_tokens_feedback integer not null default 400,
  max_tokens_weekly integer not null default 700,
  -- Days, limits and weeks are counted in this time zone.
  timezone text not null default 'Europe/Madrid',
  -- Where pg_cron sends the Monday job.
  functions_url text not null default 'https://gwyymvaxgmpamtiuhoez.supabase.co/functions/v1',
  updated_at timestamptz not null default now(),

  constraint ai_settings_single check (id = 1),
  constraint ai_settings_limit check (daily_limit between 0 and 100),
  constraint ai_settings_budget check (daily_budget_usd between 0 and 100),
  constraint ai_settings_tokens check (
    max_tokens_feedback between 100 and 4000 and max_tokens_weekly between 100 and 4000
  ),
  constraint ai_settings_model check (model ~ '^claude-[a-z0-9.-]+$')
);
alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon, authenticated;
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.ai_limit_overrides (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily_limit integer not null,
  updated_at timestamptz not null default now(),

  constraint ai_limit_overrides_range check (daily_limit between 0 and 100)
);
alter table public.ai_limit_overrides enable row level security;
revoke all on public.ai_limit_overrides from anon, authenticated;

-- Every call (and every blocked attempt). Users can read their own.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  function text not null,
  ref_id text,
  status text not null default 'pending',
  counts_toward_limit boolean not null default true,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  attempts integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  error text,
  day date not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint ai_usage_function check (function in ('workout_feedback', 'weekly_report', 'plan', 'coach')),
  constraint ai_usage_status check (
    status in ('pending', 'ok', 'error', 'blocked_limit', 'blocked_budget', 'blocked_disabled')
  )
);
create index if not exists ai_usage_day_idx on public.ai_usage (day);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, day);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists "ai_usage: read own" on public.ai_usage;
create policy "ai_usage: read own"
on public.ai_usage for select
to authenticated
using (user_id = (select auth.uid()));

-- Saved answers, so reopening never costs another call.
create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  workout_id uuid references public.workouts (id) on delete cascade,
  week_start date,
  content jsonb not null,
  model text not null,
  -- The workout as it was when the feedback was written (editing it later
  -- allows a new one).
  source_updated_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),

  constraint ai_feedback_kind check (
    (kind = 'workout' and workout_id is not null and week_start is null)
    or (kind = 'weekly' and week_start is not null and workout_id is null)
  )
);
create unique index if not exists ai_feedback_workout_idx on public.ai_feedback (user_id, workout_id) where kind = 'workout';
create unique index if not exists ai_feedback_week_idx on public.ai_feedback (user_id, week_start) where kind = 'weekly';
alter table public.ai_feedback enable row level security;
revoke all on public.ai_feedback from anon, authenticated;
grant select on public.ai_feedback to authenticated;
drop policy if exists "ai_feedback: read own" on public.ai_feedback;
create policy "ai_feedback: read own"
on public.ai_feedback for select
to authenticated
using (user_id = (select auth.uid()));

-- Expo push tokens (Android app) for "your weekly report is ready".
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),

  constraint push_tokens_token check (token ~ '^(Exponent|Expo)PushToken\[[^]]+\]$')
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

-- One row per scheduled weekly run; its token lets the Edge Function check
-- that the call really came from pg_cron (no secret to set up).
create table if not exists public.ai_cron_runs (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  week_start date not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  result jsonb
);
alter table public.ai_cron_runs enable row level security;
revoke all on public.ai_cron_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._ai_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone (select timezone from public.ai_settings where id = 1))::date $$;

-- Monday of the week containing `day`.
create or replace function public._ai_week_start(day date)
returns date
language sql
immutable
set search_path = ''
as $$ select day - ((extract(isodow from day)::int) - 1) $$;

create or replace function public._ai_limit_for(p_user uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select daily_limit from public.ai_limit_overrides where user_id = p_user),
    (select daily_limit from public.ai_settings where id = 1)
  )
$$;

-- Calls that count toward a user's limit today (finished, or still running).
create or replace function public._ai_used_today(p_user uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.ai_usage
  where user_id = p_user and day = public._ai_today() and counts_toward_limit
    and (status = 'ok' or (status = 'pending' and created_at > now() - interval '2 minutes'))
$$;

create or replace function public._ai_spent_today()
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case
    when status = 'pending' and created_at > now() - interval '2 minutes' then estimated_cost_usd
    else cost_usd end), 0)
  from public.ai_usage
  where day = public._ai_today()
$$;

-- What the user sees: is AI on, how many calls are left today.
create or replace function public.ai_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.ai_settings := (select x from public.ai_settings x where id = 1);
  lim integer := public._ai_limit_for(auth.uid());
  used integer := public._ai_used_today(auth.uid());
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enabled', s.enabled,
    'paused_for_budget', public._ai_spent_today() >= s.daily_budget_usd,
    'limit', lim,
    'used_today', used,
    'remaining', greatest(lim - used, 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Reserve a call before talking to Claude (service role only). One lock for
-- all reservations, so two taps at once (or two users at the cap) can't both
-- get through: the second sees the first one's pending row.
-- Returns {ok: true, id, model, max_tokens} or {ok: false, reason, ...}.
-- ---------------------------------------------------------------------------
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
  estimate numeric;
  lim integer;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ai_reserve'));
  select * into s from public.ai_settings where id = 1;
  max_tokens := case when p_function = 'weekly_report' then s.max_tokens_weekly else s.max_tokens_feedback end;
  -- Worst case for one call: ~2,500 input tokens (two attempts would be logged
  -- on the same row with their real tokens) plus the full output allowance.
  estimate := (2500 * s.price_input + max_tokens * s.price_output) / 1000000;

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
    lim := public._ai_limit_for(p_user);
    if public._ai_used_today(p_user) >= lim then
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

-- After the call: tokens, attempts, status and the cost (from the prices in
-- ai_settings). A failed call doesn't count toward the user's limit.
create or replace function public.ai_finish(
  p_id uuid,
  p_status text,
  p_input integer default 0,
  p_output integer default 0,
  p_cache_write integer default 0,
  p_cache_read integer default 0,
  p_attempts integer default 1,
  p_error text default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.ai_settings := (select x from public.ai_settings x where id = 1);
  cost numeric := (
    coalesce(p_input, 0) * s.price_input
    + coalesce(p_output, 0) * s.price_output
    + coalesce(p_cache_write, 0) * s.price_cache_write
    + coalesce(p_cache_read, 0) * s.price_cache_read
  ) / 1000000;
begin
  if p_status not in ('ok', 'error') then
    raise exception 'status must be ok or error' using errcode = '22023';
  end if;
  update public.ai_usage set
    status = p_status,
    input_tokens = coalesce(p_input, 0),
    output_tokens = coalesce(p_output, 0),
    cache_write_tokens = coalesce(p_cache_write, 0),
    cache_read_tokens = coalesce(p_cache_read, 0),
    attempts = coalesce(p_attempts, 1),
    cost_usd = round(cost, 6),
    error = left(p_error, 500),
    counts_toward_limit = counts_toward_limit and p_status = 'ok',
    finished_at = now()
  where id = p_id and status = 'pending';
  if not found then
    raise exception 'reservation % not pending', p_id using errcode = 'P0002';
  end if;
  return round(cost, 6);
end $$;

-- ---------------------------------------------------------------------------
-- Compact summaries for Claude (service role only; the Edge Function passes
-- the user id it verified). Weights in the user's unit, rounded.
-- ---------------------------------------------------------------------------
create or replace function public._ai_w(kg numeric, units text)
returns numeric
language sql
immutable
set search_path = ''
as $$ select case when kg is null then null when units = 'lbs' then round(kg * 2.20462, 1) else round(kg, 1) end $$;

-- "100x5", "0:45", "5.2 km in 30:00" etc. for one set.
create or replace function public._ai_set_text(
  weight_kg numeric, reps integer, duration_seconds integer, distance_m numeric, units text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when weight_kg is not null and reps is not null then public._ai_w(weight_kg, units)::text || 'x' || reps
    when reps is not null then reps::text || ' reps'
    when distance_m is not null then round(distance_m / 1000.0, 2)::text || ' km'
      || coalesce(' in ' || (duration_seconds / 60)::text || ':' || lpad((duration_seconds % 60)::text, 2, '0'), '')
    when duration_seconds is not null then (duration_seconds / 60)::text || ':' || lpad((duration_seconds % 60)::text, 2, '0')
    else 'set'
  end
$$;

-- Per exercise in one workout: working sets, top set, best e1RM, volume.
create or replace function public._ai_exercise_lines(p_workout uuid, units text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with s as (
    select x.*, e.name, e.primary_muscle::text as muscle,
      case when x.weight_kg > 0 and x.reps between 1 and 12 then x.weight_kg * (1 + x.reps / 30.0) end as e1rm
    from public.workout_sets x join public.exercises e on e.id = x.exercise_id
    where x.workout_id = p_workout
  ),
  top as (
    select distinct on (exercise_id) exercise_id,
      public._ai_set_text(weight_kg, reps, duration_seconds, distance_m, units) as text
    from s where set_type <> 'warmup'
    order by exercise_id, weight_kg desc nulls last, reps desc nulls last, duration_seconds desc nulls last, distance_m desc nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'exercise', g.name,
      'muscle', g.muscle,
      'working_sets', g.sets,
      'top_set', t.text,
      'best_e1rm', public._ai_w(g.best_e1rm, units),
      'volume', public._ai_w(g.volume, units)
    ) order by g.first_order), '[]'::jsonb)
  from (
    select exercise_id, min(name) as name, min(muscle) as muscle, min(exercise_order) as first_order,
      count(*) filter (where set_type <> 'warmup') as sets,
      max(e1rm) filter (where set_type <> 'warmup') as best_e1rm,
      round(sum(coalesce(weight_kg, 0) * coalesce(reps, 0)) filter (where set_type <> 'warmup'), 1) as volume
    from s group by exercise_id
  ) g
  left join top t on t.exercise_id = g.exercise_id
$$;

-- Working sets per muscle (primary = 1, each secondary = 0.5) in [from, to).
create or replace function public._ai_muscle_sets(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(muscle, sets order by sets desc), '{}'::jsonb)
  from (
    select muscle, round(sum(weight), 1) as sets
    from (
      select e.primary_muscle::text as muscle, 1.0 as weight
      from public.workout_sets x
      join public.workouts w on w.id = x.workout_id
      join public.exercises e on e.id = x.exercise_id
      where w.user_id = p_user and w.started_at >= p_from and w.started_at < p_to and x.set_type <> 'warmup'
      union all
      select m::text, 0.5
      from public.workout_sets x
      join public.workouts w on w.id = x.workout_id
      join public.exercises e on e.id = x.exercise_id
      cross join lateral unnest(e.secondary_muscles) m
      where w.user_id = p_user and w.started_at >= p_from and w.started_at < p_to and x.set_type <> 'warmup'
    ) t
    group by muscle
  ) g
$$;

create or replace function public._ai_athlete(p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'goal', p.goal::text,
    'experience', p.experience_level::text,
    'planned_days_per_week', p.training_days_per_week,
    'bodyweight', public._ai_w(p.bodyweight_kg, p.units::text),
    'units', p.units::text
  ))
  from public.profiles p where p.id = p_user
$$;

create or replace function public.ai_workout_context(p_user uuid, p_workout uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.workouts;
  units text := coalesce((select units::text from public.profiles where id = p_user), 'kg');
  tz text := (select timezone from public.ai_settings where id = 1);
  week_from timestamptz;
begin
  select * into w from public.workouts where id = p_workout and user_id = p_user;
  if not found then return null; end if;
  week_from := (public._ai_week_start((w.started_at at time zone tz)::date)::timestamp) at time zone tz;

  return jsonb_strip_nulls(jsonb_build_object(
    'athlete', public._ai_athlete(p_user),
    'workout', jsonb_build_object(
      'name', w.name,
      'date', to_char(w.started_at at time zone tz, 'Dy YYYY-MM-DD'),
      'duration_min', round(w.duration_seconds / 60.0),
      'volume', public._ai_w(w.total_volume_kg, units),
      'notes', left(w.notes, 300),
      'exercises', public._ai_exercise_lines(w.id, units)
    ),
    -- Up to 3 earlier sessions of each exercise in this workout (last 8 weeks).
    'previous_sessions', (
      select coalesce(jsonb_agg(jsonb_build_object('exercise', ex.name, 'sessions', ex.sessions)), '[]'::jsonb)
      from (
        select e.name, (
          select coalesce(jsonb_agg(jsonb_build_object(
              'date', to_char(p.started_at at time zone tz, 'YYYY-MM-DD'),
              'top_set', p.top_set, 'best_e1rm', public._ai_w(p.best_e1rm, units),
              'working_sets', p.sets, 'volume', public._ai_w(p.volume, units)
            ) order by p.started_at desc), '[]'::jsonb)
          from (
            select pw.id, pw.started_at,
              (select public._ai_set_text(t.weight_kg, t.reps, t.duration_seconds, t.distance_m, units) from public.workout_sets t
               where t.workout_id = pw.id and t.exercise_id = e.id and t.set_type <> 'warmup'
               order by t.weight_kg desc nulls last, t.reps desc nulls last, t.duration_seconds desc nulls last limit 1) as top_set,
              (select max(t.weight_kg * (1 + t.reps / 30.0)) from public.workout_sets t
               where t.workout_id = pw.id and t.exercise_id = e.id and t.set_type <> 'warmup'
                 and t.weight_kg > 0 and t.reps between 1 and 12) as best_e1rm,
              (select count(*) from public.workout_sets t
               where t.workout_id = pw.id and t.exercise_id = e.id and t.set_type <> 'warmup') as sets,
              (select round(sum(coalesce(t.weight_kg, 0) * coalesce(t.reps, 0)), 1) from public.workout_sets t
               where t.workout_id = pw.id and t.exercise_id = e.id and t.set_type <> 'warmup') as volume
            from public.workouts pw
            where pw.user_id = p_user and pw.started_at < w.started_at
              and pw.started_at > w.started_at - interval '8 weeks'
              and exists (select 1 from public.workout_sets t where t.workout_id = pw.id and t.exercise_id = e.id)
            order by pw.started_at desc
            limit 3
          ) p
        ) as sessions
        from (
          select x.exercise_id, min(x.exercise_order) as ord from public.workout_sets x
          where x.workout_id = w.id group by x.exercise_id
        ) we
        join public.exercises e on e.id = we.exercise_id
        order by we.ord
      ) ex
      where jsonb_array_length(ex.sessions) > 0
    ),
    'new_records', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'exercise', e.name, 'record', r.record_type::text,
          'value', case when r.record_type in ('heaviest_weight', 'best_e1rm', 'session_volume')
                        then public._ai_w(r.value, units) else r.value end,
          'previous', case when r.record_type in ('heaviest_weight', 'best_e1rm', 'session_volume')
                           then public._ai_w(r.previous_value, units) else r.previous_value end
        )), '[]'::jsonb)
      from public.personal_records r join public.exercises e on e.id = r.exercise_id
      where r.workout_id = w.id and r.user_id = p_user and r.record_type <> 'reps_at_weight'
        and r.previous_value is not null and r.value > r.previous_value
    ),
    'this_week', jsonb_build_object(
      'workouts', (select count(*) from public.workouts x where x.user_id = p_user and x.started_at >= week_from and x.started_at < week_from + interval '7 days'),
      'sets_by_muscle', public._ai_muscle_sets(p_user, week_from, week_from + interval '7 days')
    ),
    -- Weekly totals for the 4 weeks before this one (volume jumps).
    'previous_weeks', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'week_start', to_char(ws, 'YYYY-MM-DD'),
          'workouts', (select count(*) from public.workouts x where x.user_id = p_user and x.started_at >= ws and x.started_at < ws + interval '7 days'),
          'volume', public._ai_w((select coalesce(sum(x.total_volume_kg), 0) from public.workouts x where x.user_id = p_user and x.started_at >= ws and x.started_at < ws + interval '7 days'), units)
        ) order by ws desc), '[]'::jsonb)
      from generate_series(week_from - interval '4 weeks', week_from - interval '1 week', interval '1 week') ws
    )
  ));
end $$;

create or replace function public.ai_week_context(p_user uuid, p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  units text := coalesce((select units::text from public.profiles where id = p_user), 'kg');
  tz text := (select timezone from public.ai_settings where id = 1);
  wf timestamptz := (p_week_start::timestamp) at time zone tz;
  wt timestamptz := ((p_week_start + 7)::timestamp) at time zone tz;
begin
  if not exists (select 1 from public.workouts where user_id = p_user and started_at >= wf and started_at < wt) then
    return null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'athlete', public._ai_athlete(p_user),
    'week', jsonb_build_object(
      'start', to_char(p_week_start, 'YYYY-MM-DD'),
      'sessions', (
        select jsonb_agg(jsonb_build_object(
            'date', to_char(w.started_at at time zone tz, 'Dy MM-DD'), 'name', w.name,
            'duration_min', round(w.duration_seconds / 60.0), 'volume', public._ai_w(w.total_volume_kg, units),
            'notes', left(w.notes, 150)
          ) order by w.started_at)
        from public.workouts w where w.user_id = p_user and w.started_at >= wf and w.started_at < wt
      ),
      'total_volume', public._ai_w((select sum(total_volume_kg) from public.workouts where user_id = p_user and started_at >= wf and started_at < wt), units),
      'sets_by_muscle', public._ai_muscle_sets(p_user, wf, wt)
    ),
    'new_records', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'exercise', e.name, 'record', r.record_type::text,
          'value', case when r.record_type in ('heaviest_weight', 'best_e1rm', 'session_volume')
                        then public._ai_w(r.value, units) else r.value end,
          'previous', case when r.record_type in ('heaviest_weight', 'best_e1rm', 'session_volume')
                           then public._ai_w(r.previous_value, units) else r.previous_value end
        )), '[]'::jsonb)
      from public.personal_records r
      join public.exercises e on e.id = r.exercise_id
      join public.workouts w on w.id = r.workout_id
      where r.user_id = p_user and w.started_at >= wf and w.started_at < wt and r.record_type <> 'reps_at_weight'
        and r.previous_value is not null and r.value > r.previous_value
    ),
    -- Main lifts this week vs the 4 weeks before (best e1RM).
    'top_exercises', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'exercise', t.name, 'sets', t.sets,
          'best_e1rm', public._ai_w(t.e1rm_now, units), 'best_e1rm_prev_4_weeks', public._ai_w(t.e1rm_before, units)
        ) order by t.sets desc), '[]'::jsonb)
      from (
        select e.name, count(*) as sets,
          max(x.weight_kg * (1 + x.reps / 30.0)) filter (where x.weight_kg > 0 and x.reps between 1 and 12) as e1rm_now,
          (select max(y.weight_kg * (1 + y.reps / 30.0)) from public.workout_sets y join public.workouts yw on yw.id = y.workout_id
           where yw.user_id = p_user and y.exercise_id = e.id and y.set_type <> 'warmup'
             and yw.started_at >= wf - interval '4 weeks' and yw.started_at < wf and y.weight_kg > 0 and y.reps between 1 and 12) as e1rm_before
        from public.workout_sets x
        join public.workouts w on w.id = x.workout_id
        join public.exercises e on e.id = x.exercise_id
        where w.user_id = p_user and w.started_at >= wf and w.started_at < wt and x.set_type <> 'warmup'
        group by e.id, e.name
        order by count(*) desc
        limit 8
      ) t
    ),
    'previous_weeks', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'week_start', to_char(ws, 'YYYY-MM-DD'),
          'workouts', (select count(*) from public.workouts x where x.user_id = p_user and x.started_at >= ws and x.started_at < ws + interval '7 days'),
          'volume', public._ai_w((select coalesce(sum(x.total_volume_kg), 0) from public.workouts x where x.user_id = p_user and x.started_at >= ws and x.started_at < ws + interval '7 days'), units)
        ) order by ws desc), '[]'::jsonb)
      from generate_series(wf - interval '4 weeks', wf - interval '1 week', interval '1 week') ws
    )
  ));
end $$;

-- Saves an answer (service role). A newer answer for the same workout/week replaces the old one.
create or replace function public.ai_save_feedback(
  p_user uuid,
  p_kind text,
  p_workout uuid,
  p_week_start date,
  p_content jsonb,
  p_model text
)
returns public.ai_feedback
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.ai_feedback;
begin
  if p_kind = 'workout' then
    delete from public.ai_feedback where user_id = p_user and kind = 'workout' and workout_id = p_workout;
    insert into public.ai_feedback (user_id, kind, workout_id, content, model, source_updated_at)
    values (p_user, 'workout', p_workout, p_content, p_model,
            (select updated_at from public.workouts where id = p_workout and user_id = p_user))
    returning * into result;
  else
    delete from public.ai_feedback where user_id = p_user and kind = 'weekly' and week_start = p_week_start;
    insert into public.ai_feedback (user_id, kind, week_start, content, model)
    values (p_user, 'weekly', p_week_start, p_content, p_model)
    returning * into result;
  end if;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Weekly reports
-- ---------------------------------------------------------------------------

-- The week that ended last Sunday.
create or replace function public.ai_last_week_start()
returns date
language sql
stable
set search_path = ''
as $$ select public._ai_week_start(public._ai_today()) - 7 $$;

-- Users who trained that week and don't have its report yet.
create or replace function public.ai_weekly_candidates(p_week_start date)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct w.user_id
  from public.workouts w
  where w.started_at >= ((p_week_start::timestamp) at time zone (select timezone from public.ai_settings where id = 1))
    and w.started_at < (((p_week_start + 7)::timestamp) at time zone (select timezone from public.ai_settings where id = 1))
    and not exists (
      select 1 from public.ai_feedback f
      where f.user_id = w.user_id and f.kind = 'weekly' and f.week_start = p_week_start
    )
$$;

-- pg_cron calls this: it creates a run with a one-time token and asks the
-- weekly-report Edge Function (through pg_net) to do the work.
create or replace function public.ai_start_weekly_run()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  run_id uuid;
  url text := (select functions_url from public.ai_settings where id = 1) || '/weekly-report';
begin
  insert into public.ai_cron_runs (token_hash, week_start)
  values (extensions.digest(token, 'sha256'), public.ai_last_week_start())
  returning id into run_id;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using url,
          jsonb_build_object('run_id', run_id, 'token', token),
          jsonb_build_object('Content-Type', 'application/json');
  return run_id;
end $$;

-- The Edge Function checks the token (once, within an hour) and gets the week.
create or replace function public.ai_claim_weekly_run(p_run uuid, p_token text)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  week date;
begin
  update public.ai_cron_runs set claimed_at = now()
  where id = p_run and token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and claimed_at is null and created_at > now() - interval '1 hour'
  returning week_start into week;
  if week is null then
    raise exception 'invalid or used run' using errcode = '42501';
  end if;
  return week;
end $$;

create or replace function public.ai_finish_weekly_run(p_run uuid, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$ update public.ai_cron_runs set result = p_result where id = p_run $$;

-- ---------------------------------------------------------------------------
-- App side
-- ---------------------------------------------------------------------------
create or replace function public.ai_mark_seen(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_feedback set seen_at = coalesce(seen_at, now())
  where id = p_id and user_id = (select auth.uid())
$$;

create or replace function public.save_push_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- A phone that changed hands moves to the new account.
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), coalesce(p_platform, 'android'))
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create or replace function public.delete_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.push_tokens where token = p_token and user_id = (select auth.uid()) $$;

-- ---------------------------------------------------------------------------
-- Admin (checked and logged)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ai_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return (select to_jsonb(s) - 'id' - 'functions_url' from public.ai_settings s where id = 1)
    || jsonb_build_object('spent_today_usd', round(public._ai_spent_today(), 4));
end $$;

create or replace function public.admin_update_ai_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before jsonb;
  allowed text[] := array['enabled', 'daily_limit', 'daily_budget_usd', 'model', 'max_tokens_feedback',
                          'max_tokens_weekly', 'price_input', 'price_output', 'price_cache_write', 'price_cache_read'];
  k text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not k = any(allowed) then raise exception 'unknown setting %', k using errcode = '22023'; end if;
  end loop;
  select to_jsonb(s) into before from public.ai_settings s where id = 1;
  update public.ai_settings set
    enabled = coalesce((p_changes ->> 'enabled')::boolean, enabled),
    daily_limit = coalesce((p_changes ->> 'daily_limit')::integer, daily_limit),
    daily_budget_usd = coalesce((p_changes ->> 'daily_budget_usd')::numeric, daily_budget_usd),
    model = coalesce(nullif(btrim(p_changes ->> 'model'), ''), model),
    max_tokens_feedback = coalesce((p_changes ->> 'max_tokens_feedback')::integer, max_tokens_feedback),
    max_tokens_weekly = coalesce((p_changes ->> 'max_tokens_weekly')::integer, max_tokens_weekly),
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

create or replace function public.admin_set_ai_override(p_user uuid, p_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_limit is null then
    delete from public.ai_limit_overrides where user_id = p_user;
  else
    insert into public.ai_limit_overrides (user_id, daily_limit) values (p_user, p_limit)
    on conflict (user_id) do update set daily_limit = excluded.daily_limit, updated_at = now();
  end if;
  perform public.log_admin_action('ai.override', 'user', p_user::text, jsonb_build_object('daily_limit', p_limit));
end $$;

create or replace function public.admin_ai_overrides()
returns table (user_id uuid, username text, display_name text, daily_limit integer, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select o.user_id, p.username, p.display_name, o.daily_limit, o.updated_at
    from public.ai_limit_overrides o left join public.profiles p on p.id = o.user_id
    order by p.username;
end $$;

-- Find a user by username, name or email (for overrides).
create or replace function public.admin_find_users(p_query text)
returns table (user_id uuid, username text, display_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select p.id, p.username, p.display_name, u.email::text
    from public.profiles p join auth.users u on u.id = p.id
    where length(btrim(coalesce(p_query, ''))) >= 2 and (
      p.username ilike '%' || btrim(p_query) || '%'
      or p.display_name ilike '%' || btrim(p_query) || '%'
      or u.email ilike '%' || btrim(p_query) || '%'
    )
    order by p.username
    limit 10;
end $$;

-- Dashboard: calls and cost per day (last p_days days), top users, error rate.
create or replace function public.admin_ai_usage(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since date := public._ai_today() - (greatest(1, least(p_days, 365)) - 1);
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'since', since,
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day::date, 'calls', coalesce(u.calls, 0), 'errors', coalesce(u.errors, 0),
          'blocked', coalesce(u.blocked, 0), 'cost_usd', coalesce(u.cost, 0)
        ) order by d.day), '[]'::jsonb)
      from generate_series(since, public._ai_today(), interval '1 day') d(day)
      left join (
        select day,
          count(*) filter (where status in ('ok', 'error')) as calls,
          count(*) filter (where status = 'error') as errors,
          count(*) filter (where status like 'blocked%') as blocked,
          round(sum(cost_usd), 4) as cost
        from public.ai_usage where day >= since group by day
      ) u on u.day = d.day::date
    ),
    'top_users', (
      select coalesce(jsonb_agg(t order by t.cost_usd desc, t.calls desc), '[]'::jsonb)
      from (
        select u.user_id, p.username, count(*) filter (where u.status in ('ok', 'error')) as calls,
          round(sum(u.cost_usd), 4) as cost_usd
        from public.ai_usage u left join public.profiles p on p.id = u.user_id
        where u.day >= since
        group by u.user_id, p.username
        order by sum(u.cost_usd) desc, count(*) desc
        limit 5
      ) t
    ),
    'totals', (
      select jsonb_build_object(
        'calls', count(*) filter (where status in ('ok', 'error')),
        'errors', count(*) filter (where status = 'error'),
        'blocked', count(*) filter (where status like 'blocked%'),
        'error_rate', round(coalesce(
          (count(*) filter (where status = 'error'))::numeric
          / nullif(count(*) filter (where status in ('ok', 'error')), 0), 0), 3),
        'cost_usd', round(coalesce(sum(cost_usd), 0), 4),
        'input_tokens', coalesce(sum(input_tokens + cache_write_tokens + cache_read_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0)
      )
      from public.ai_usage where day >= since
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  -- Internal helpers and service-role functions: no client access.
  foreach f in array array[
    'public._ai_today()', 'public._ai_week_start(date)', 'public._ai_limit_for(uuid)',
    'public._ai_used_today(uuid)', 'public._ai_spent_today()', 'public._ai_w(numeric, text)',
    'public._ai_set_text(numeric, integer, integer, numeric, text)', 'public._ai_exercise_lines(uuid, text)',
    'public._ai_muscle_sets(uuid, timestamptz, timestamptz)', 'public._ai_athlete(uuid)',
    'public.ai_reserve(uuid, text, text, boolean)',
    'public.ai_finish(uuid, text, integer, integer, integer, integer, integer, text)',
    'public.ai_workout_context(uuid, uuid)', 'public.ai_week_context(uuid, date)',
    'public.ai_save_feedback(uuid, text, uuid, date, jsonb, text)', 'public.ai_last_week_start()',
    'public.ai_weekly_candidates(date)', 'public.ai_start_weekly_run()',
    'public.ai_claim_weekly_run(uuid, text)', 'public.ai_finish_weekly_run(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.ai_reserve(uuid, text, text, boolean)',
    'public.ai_finish(uuid, text, integer, integer, integer, integer, integer, text)',
    'public.ai_workout_context(uuid, uuid)', 'public.ai_week_context(uuid, date)',
    'public.ai_save_feedback(uuid, text, uuid, date, jsonb, text)', 'public.ai_last_week_start()',
    'public.ai_weekly_candidates(date)', 'public.ai_claim_weekly_run(uuid, text)',
    'public.ai_finish_weekly_run(uuid, jsonb)'
  ] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Signed-in users (admin functions check is_admin() themselves).
  foreach f in array array[
    'public.ai_status()', 'public.ai_mark_seen(uuid)', 'public.save_push_token(text, text)',
    'public.delete_push_token(text)', 'public.admin_ai_settings()',
    'public.admin_update_ai_settings(jsonb)', 'public.admin_set_ai_override(uuid, integer)',
    'public.admin_ai_overrides()', 'public.admin_find_users(text)', 'public.admin_ai_usage(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Service role reads/writes the AI tables directly from the Edge Functions.
grant select, insert, update, delete on public.ai_settings, public.ai_usage, public.ai_feedback,
  public.push_tokens, public.ai_cron_runs to service_role;

-- ---------------------------------------------------------------------------
-- Schedule: Mondays 06:15 UTC (07:15/08:15 in Barcelona) for last week's
-- reports; Tuesday and Wednesday catch up anyone skipped because the
-- spending cap or the kill switch stopped Monday's run. Needs pg_cron and
-- pg_net (Supabase: Database → Extensions); skipped with a notice if missing.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net not available: weekly reports are not scheduled';
    return;
  end if;
  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('weekly-ai-reports', '15 6 * * 1-3', 'select public.ai_start_weekly_run()');
exception when others then
  raise warning 'Could not schedule weekly reports (%). Enable pg_cron and pg_net in the dashboard and run this file again.', sqlerrm;
end $$;
