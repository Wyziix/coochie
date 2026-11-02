-- Stage 8: points, levels, anti-cheat flags and leaderboards.
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- Points are computed only here, inside after_workout_change() (called by
-- save_workout and delete_workout, also when offline workouts sync). The
-- ledger is rebuilt from the workouts each time, so re-syncs and edits can't
-- give double points, and deleting a workout removes its points.

-- ---------------------------------------------------------------------------
-- Settings: every point value, cap and anti-cheat threshold (Admin → Points).
-- ---------------------------------------------------------------------------
create table if not exists public.points_settings (
  id smallint primary key default 1,
  -- Per workout
  workout_points integer not null default 50,
  min_working_sets integer not null default 3,
  set_points integer not null default 1,
  set_points_cap integer not null default 25,
  pr_points integer not null default 15,
  pr_cap integer not null default 3,
  daily_cap integer not null default 300,
  -- Per week (Monday-Sunday)
  weekly_goal_points integer not null default 100,
  goal_min_days integer not null default 2,
  goal_max_days integer not null default 6,
  streak_points integer not null default 20,
  streak_cap_weeks integer not null default 5,
  -- Levels: level L needs round(level_base × (L-1)^level_exponent) points.
  level_base integer not null default 100,
  level_exponent numeric not null default 1.6,
  -- Anti-cheat
  flag_min_minutes integer not null default 10,
  flag_max_workouts_per_day integer not null default 3,
  flag_backdate_days integer not null default 7,
  flag_jump_pct integer not null default 30,
  flag_jump_min_kg numeric not null default 15,
  flag_max_set_kg numeric not null default 600,
  flag_default_bodyweight_kg numeric not null default 100,
  -- Heaviest believable set = bodyweight × muscle ratio × equipment factor.
  weight_ratios jsonb not null default '{"quads": 4.5, "glutes": 4.5, "hamstrings": 3.5, "adductors": 3,
    "calves": 4, "back": 3, "lower_back": 4, "traps": 4, "chest": 3, "shoulders": 2, "triceps": 1.5,
    "biceps": 1.2, "forearms": 1.2, "abs": 1.5, "obliques": 1.5, "full_body": 3, "cardio": 2}'::jsonb,
  equipment_factors jsonb not null default '{"barbell": 1, "ez_bar": 1, "smith_machine": 1.2, "machine": 2,
    "cable": 1.3, "dumbbell": 0.6, "kettlebell": 0.6, "bodyweight": 1.5, "band": 1, "cardio_machine": 1,
    "other": 1.5}'::jsonb,
  timezone text not null default 'Europe/Madrid',
  updated_at timestamptz not null default now(),

  constraint points_settings_single check (id = 1),
  constraint points_settings_values check (
    workout_points between 0 and 1000 and min_working_sets between 0 and 50
    and set_points between 0 and 100 and set_points_cap between 0 and 1000
    and pr_points between 0 and 1000 and pr_cap between 0 and 20 and daily_cap between 0 and 10000
    and weekly_goal_points between 0 and 5000 and goal_min_days between 1 and 7
    and goal_max_days between goal_min_days and 7 and streak_points between 0 and 1000
    and streak_cap_weeks between 0 and 52 and level_base between 1 and 100000
    and level_exponent between 1 and 3
  ),
  constraint points_settings_flags check (
    flag_min_minutes between 0 and 120 and flag_max_workouts_per_day between 1 and 20
    and flag_backdate_days between 1 and 365 and flag_jump_pct between 5 and 500
    and flag_jump_min_kg between 0 and 200 and flag_max_set_kg between 50 and 1000
    and flag_default_bodyweight_kg between 30 and 250
  )
);
insert into public.points_settings (id) values (1) on conflict (id) do nothing;
alter table public.points_settings enable row level security;
revoke all on public.points_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ledger: one row per reason and source. Users read their own.
-- ---------------------------------------------------------------------------
create table if not exists public.points_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null,
  reason text not null,
  source_type text not null,
  source_id text not null,
  workout_id uuid references public.workouts (id) on delete cascade,
  earned_at timestamptz not null,
  -- Day it counts for, in the leaderboard time zone.
  day date not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint points_ledger_reason check (reason in ('workout', 'sets', 'pr', 'daily_cap', 'weekly_goal', 'streak')),
  constraint points_ledger_source check (source_type in ('workout', 'week')),
  constraint points_ledger_once unique (user_id, reason, source_type, source_id)
);
create index if not exists points_ledger_user_day_idx on public.points_ledger (user_id, day);
create index if not exists points_ledger_workout_idx on public.points_ledger (workout_id);
alter table public.points_ledger enable row level security;
revoke all on public.points_ledger from anon, authenticated;
grant select on public.points_ledger to authenticated;
drop policy if exists "points_ledger: read own" on public.points_ledger;
create policy "points_ledger: read own"
on public.points_ledger for select
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Flags: suspicious workouts get no points until an admin approves them.
-- Users don't read this table (they only see "Under review").
-- ---------------------------------------------------------------------------
create table if not exists public.workout_flags (
  workout_id uuid primary key references public.workouts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  reasons jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,

  constraint workout_flags_status check (status in ('pending', 'approved', 'rejected'))
);
create index if not exists workout_flags_status_idx on public.workout_flags (status, created_at);
create index if not exists workout_flags_user_idx on public.workout_flags (user_id);
alter table public.workout_flags enable row level security;
revoke all on public.workout_flags from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Moderation (admins only) and "hide me" (the user's own choice).
-- ---------------------------------------------------------------------------
create table if not exists public.user_moderation (
  user_id uuid primary key references auth.users (id) on delete cascade,
  leaderboard_banned boolean not null default false,
  hidden boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint user_moderation_note check (char_length(note) <= 300)
);
alter table public.user_moderation enable row level security;
revoke all on public.user_moderation from anon, authenticated;

alter table public.profiles add column if not exists leaderboard_hidden boolean not null default false;

grant select, insert, update, delete on public.points_ledger, public.workout_flags, public.user_moderation to service_role;
grant select on public.points_settings to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._points_day(at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$ select (at at time zone (select timezone from public.points_settings where id = 1))::date $$;

create or replace function public._points_week_start(d date)
returns date
language sql
immutable
set search_path = ''
as $$ select (d - ((extract(isodow from d)::int - 1)))::date $$;

-- Level 1-50 for a points total, with its name and the range to the next.
create or replace function public.level_for(p_points bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with s as (select level_base, level_exponent from public.points_settings where id = 1),
  t as (
    select l, round(s.level_base * power(l - 1, s.level_exponent))::bigint as min_points
    from s, generate_series(1, 50) l
  ),
  cur as (select max(l) as level from t where min_points <= greatest(coalesce(p_points, 0), 0))
  select jsonb_build_object(
    'level', cur.level,
    'name', (array['Rookie', 'Regular', 'Grinder', 'Athlete', 'Iron', 'Steel', 'Titan', 'Champion',
                   'Legend', 'Lightweight Baby'])[(cur.level - 1) / 5 + 1]
            || ' ' || (array['I', 'II', 'III', 'IV', 'V'])[(cur.level - 1) % 5 + 1],
    'min_points', (select min_points from t where l = cur.level),
    'next_points', (select min_points from t where l = cur.level + 1),
    'points', greatest(coalesce(p_points, 0), 0)
  )
  from cur
$$;

-- Workouts whose sets count (not flagged, or approved by an admin).
create or replace function public._workout_counts(p_workout uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.workout_flags f where f.workout_id = p_workout and f.status <> 'approved'
  )
$$;

-- ---------------------------------------------------------------------------
-- Anti-cheat: (re)checks one workout and stores its flag. An approved or
-- rejected decision stays if the reasons didn't change; new reasons send it
-- back for review.
-- ---------------------------------------------------------------------------
create or replace function public._flag_workout(p_workout uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.points_settings := (select x from public.points_settings x where id = 1);
  w public.workouts := (select x from public.workouts x where id = p_workout);
  bw numeric;
  hits jsonb := '[]'::jsonb;
  position_today integer;
  old public.workout_flags;
  codes text[];
  old_codes text[];
begin
  if w.id is null then return; end if;
  bw := coalesce((select bodyweight_kg from public.profiles where id = w.user_id), s.flag_default_bodyweight_kg);

  -- Heavier than believable for the exercise and the lifter's bodyweight.
  hits := hits || coalesce((
    select jsonb_agg(jsonb_build_object('reason', 'unrealistic_weight', 'exercise', x.name,
                                        'weight_kg', x.weight, 'limit_kg', x.lim) order by x.name)
    from (
      select e.name, max(ws.weight_kg) as weight,
        round(least(s.flag_max_set_kg, bw * coalesce((s.weight_ratios ->> e.primary_muscle::text)::numeric, 2)
          * coalesce((s.equipment_factors ->> e.equipment::text)::numeric, 1)), 1) as lim
      from public.workout_sets ws join public.exercises e on e.id = ws.exercise_id
      where ws.workout_id = w.id and ws.weight_kg > 0
      group by e.name, e.primary_muscle, e.equipment
    ) x
    where x.weight > x.lim
  ), '[]'::jsonb);

  -- A huge jump over the previous best (from workouts that count).
  hits := hits || coalesce((
    select jsonb_agg(jsonb_build_object('reason', 'big_jump', 'exercise', x.name,
                                        'weight_kg', x.weight, 'previous_kg', x.prev) order by x.name)
    from (
      select e.name, max(ws.weight_kg) as weight,
        (select max(p.weight_kg) from public.workout_sets p join public.workouts pw on pw.id = p.workout_id
         where pw.user_id = w.user_id and p.exercise_id = ws.exercise_id and pw.started_at < w.started_at
           and p.set_type <> 'warmup' and public._workout_counts(pw.id)) as prev
      from public.workout_sets ws join public.exercises e on e.id = ws.exercise_id
      where ws.workout_id = w.id and ws.weight_kg > 0 and ws.set_type <> 'warmup'
      group by e.name, ws.exercise_id
    ) x
    where x.prev > 0 and x.weight > x.prev * (1 + s.flag_jump_pct / 100.0) and x.weight - x.prev >= s.flag_jump_min_kg
  ), '[]'::jsonb);

  if w.duration_seconds < s.flag_min_minutes * 60 then
    hits := hits || jsonb_build_array(jsonb_build_object(
      'reason', 'too_short', 'minutes', round(w.duration_seconds / 60.0, 1)));
  end if;

  select count(*) into position_today from public.workouts o
  where o.user_id = w.user_id and public._points_day(o.started_at) = public._points_day(w.started_at)
    and (o.started_at, o.id) <= (w.started_at, w.id);
  if position_today > s.flag_max_workouts_per_day then
    hits := hits || jsonb_build_array(jsonb_build_object(
      'reason', 'too_many_today', 'workout_of_the_day', position_today));
  end if;

  if w.created_at - w.started_at > make_interval(days => s.flag_backdate_days) then
    hits := hits || jsonb_build_array(jsonb_build_object(
      'reason', 'backdated', 'days', floor(extract(epoch from (w.created_at - w.started_at)) / 86400)));
  end if;

  select * into old from public.workout_flags where workout_id = w.id;
  if jsonb_array_length(hits) = 0 then
    delete from public.workout_flags where workout_id = w.id;
    return;
  end if;
  codes := array(select distinct r ->> 'reason' from jsonb_array_elements(hits) r order by 1);
  if old.workout_id is null then
    insert into public.workout_flags (workout_id, user_id, reasons) values (w.id, w.user_id, hits);
    return;
  end if;
  old_codes := array(select distinct r ->> 'reason' from jsonb_array_elements(old.reasons) r order by 1);
  if old.status <> 'pending' and codes <@ old_codes then
    update public.workout_flags set reasons = hits, updated_at = now() where workout_id = w.id;
  else
    update public.workout_flags
    set reasons = hits, status = 'pending', reviewed_by = null, reviewed_at = null, updated_at = now()
    where workout_id = w.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Points: rebuilds the user's ledger from their workouts (deterministic).
-- ---------------------------------------------------------------------------
create or replace function public.recompute_points(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.points_settings := (select x from public.points_settings x where id = 1);
  goal integer;
begin
  goal := least(s.goal_max_days, greatest(s.goal_min_days,
    coalesce((select training_days_per_week from public.profiles where id = p_user), s.goal_min_days)));

  delete from public.points_ledger where user_id = p_user;

  -- Per workout that counts (not flagged, or approved).
  insert into public.points_ledger (user_id, points, reason, source_type, source_id, workout_id, earned_at, day, details)
  with w as (
    select w.id, w.started_at, public._points_day(w.started_at) as day,
      (select count(*) from public.workout_sets ws where ws.workout_id = w.id and ws.set_type <> 'warmup'
         and (coalesce(ws.reps, 0) > 0 or coalesce(ws.duration_seconds, 0) > 0 or coalesce(ws.distance_m, 0) > 0)
      )::int as working_sets,
      coalesce(pr.n, 0) as prs, coalesce(pr.list, '[]'::jsonb) as prs_list
    from public.workouts w
    left join lateral (
      -- A PR: heavier than every earlier set of that exercise in workouts
      -- that count. The first time doing an exercise is the baseline.
      select count(*)::int as n, jsonb_agg(x.name order by x.name) as list
      from (
        select e.name, max(ws.weight_kg) as best,
          (select max(p.weight_kg) from public.workout_sets p join public.workouts pw on pw.id = p.workout_id
           where pw.user_id = p_user and p.exercise_id = ws.exercise_id and p.set_type <> 'warmup'
             and (pw.started_at, pw.id) < (w.started_at, w.id) and public._workout_counts(pw.id)) as prev
        from public.workout_sets ws join public.exercises e on e.id = ws.exercise_id
        where ws.workout_id = w.id and ws.set_type <> 'warmup' and ws.weight_kg > 0
        group by e.name, ws.exercise_id
      ) x
      where x.prev > 0 and x.best > x.prev
    ) pr on true
    where w.user_id = p_user and public._workout_counts(w.id)
  ),
  b as (
    select w.*, case when working_sets >= s.min_working_sets then s.workout_points else 0 end as base
    from w
  ),
  t as (
    select b.*,
      case when base > 0 then least(working_sets * s.set_points, s.set_points_cap) else 0 end as sets_pts,
      case when base > 0 then least(prs, s.pr_cap) * s.pr_points else 0 end as pr_pts
    from b
  ),
  c as (
    -- Daily cap: workouts in the order they were done; what goes over is cut.
    select t.*,
      greatest(0, sum(base + sets_pts + pr_pts) over d - s.daily_cap)
        - greatest(0, coalesce(sum(base + sets_pts + pr_pts) over (d rows between unbounded preceding and 1 preceding), 0)
                      - s.daily_cap) as clip
    from t
    window d as (partition by day order by started_at, id)
  )
  select p_user, x.points, x.reason, 'workout', c.id::text, c.id, c.started_at, c.day, x.details
  from c
  cross join lateral (values
    ('workout', c.base, '{}'::jsonb),
    ('sets', c.sets_pts, jsonb_build_object('working_sets', c.working_sets)),
    ('pr', c.pr_pts, jsonb_build_object('exercises', c.prs_list)),
    ('daily_cap', -c.clip::int, jsonb_build_object('cap', s.daily_cap))
  ) as x(reason, points, details)
  where x.points <> 0;

  -- Weekly goal and streak: a week counts when the workouts that earned
  -- points reach the planned days (between goal_min_days and goal_max_days).
  insert into public.points_ledger (user_id, points, reason, source_type, source_id, workout_id, earned_at, day, details)
  select p_user, x.points, x.reason, 'week', h.week_start::text, h.workout_id, h.earned_at, h.day, x.details
  from (
    select g.*, row_number() over (partition by g.island order by g.week_start) as streak
    from (
      select k.*, k.week_start - (row_number() over (order by k.week_start) * 7)::int as island
      from (
        select public._points_week_start(day) as week_start,
          (array_agg(workout_id order by earned_at, workout_id))[goal] as workout_id,
          (array_agg(earned_at order by earned_at, workout_id))[goal] as earned_at,
          (array_agg(day order by earned_at, workout_id))[goal] as day,
          count(*) as sessions
        from public.points_ledger
        where user_id = p_user and reason = 'workout'
        group by 1
        having count(*) >= goal
      ) k
    ) g
  ) h
  cross join lateral (values
    ('weekly_goal', s.weekly_goal_points, jsonb_build_object('goal', goal, 'sessions', h.sessions)),
    ('streak', least(h.streak - 1, s.streak_cap_weeks)::int * s.streak_points, jsonb_build_object('weeks', h.streak))
  ) as x(reason, points, details)
  where x.points > 0;

  update public.leaderboard_state set dirty = true where id = 1 and not dirty;
end $$;

-- ---------------------------------------------------------------------------
-- Leaderboards: a materialized view of each user's totals, refreshed when
-- points changed or a new week/month started (Monday, Europe/Madrid).
-- ---------------------------------------------------------------------------
create table if not exists public.leaderboard_state (
  id smallint primary key default 1,
  dirty boolean not null default true,
  refreshed_at timestamptz,
  constraint leaderboard_state_single check (id = 1)
);
insert into public.leaderboard_state (id) values (1) on conflict (id) do nothing;
alter table public.leaderboard_state enable row level security;
revoke all on public.leaderboard_state from anon, authenticated;

create materialized view if not exists public.leaderboard_totals as
  with b as (
    select public._points_week_start(public._points_day(now())) as week_start,
           date_trunc('month', public._points_day(now()))::date as month_start
  )
  select l.user_id,
    sum(l.points)::bigint as total,
    coalesce(sum(l.points) filter (where l.day >= b.week_start), 0)::bigint as week,
    coalesce(sum(l.points) filter (where l.day >= b.month_start), 0)::bigint as month,
    b.week_start, b.month_start, now() as refreshed_at
  from public.points_ledger l cross join b
  group by l.user_id, b.week_start, b.month_start;
create unique index if not exists leaderboard_totals_user_idx on public.leaderboard_totals (user_id);
revoke all on public.leaderboard_totals from anon, authenticated;

create or replace function public._refresh_leaderboard()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.leaderboard_state := (select x from public.leaderboard_state x where id = 1);
  week_now date := public._points_week_start(public._points_day(now()));
  month_now date := date_trunc('month', public._points_day(now()))::date;
  built record;
begin
  select week_start, month_start into built from public.leaderboard_totals limit 1;
  if not st.dirty and st.refreshed_at is not null
     and (built is null or (built.week_start = week_now and built.month_start = month_now)) then
    return;
  end if;
  -- One refresh at a time; others use the current copy.
  if not pg_try_advisory_xact_lock(hashtext('leaderboard_refresh')) then return; end if;
  update public.leaderboard_state set dirty = false where id = 1;
  refresh materialized view public.leaderboard_totals;
  update public.leaderboard_state set refreshed_at = now() where id = 1;
end $$;

-- Who appears on public boards: has a username, not hidden by themselves,
-- not banned or hidden by an admin.
create or replace function public._on_leaderboards(p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.username is not null and not p.leaderboard_hidden
      and not exists (select 1 from public.user_moderation m
                      where m.user_id = p.id and (m.leaderboard_banned or m.hidden))
  )
$$;

-- p_period: week, month or all. Only username, avatar, level and points.
-- "me" is always included (with the rank I'd have if I'm hidden).
create or replace function public.leaderboard(p_period text default 'week', p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result jsonb;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_period not in ('week', 'month', 'all') then raise exception 'unknown period %', p_period using errcode = '22023'; end if;
  perform public._refresh_leaderboard();

  with base as (
    select t.user_id,
      case p_period when 'week' then t.week when 'month' then t.month else t.total end as points,
      t.total, public._on_leaderboards(t.user_id) as visible
    from public.leaderboard_totals t
  ),
  ranked as (
    select b.*, p.username, p.avatar_url,
      rank() over (order by b.points desc) as rank,
      row_number() over (order by b.points desc, p.username) as pos
    from base b join public.profiles p on p.id = b.user_id
    where b.visible and b.points > 0
  ),
  me as (
    select b.points, b.total, b.visible,
      (select count(*) from ranked r where r.points > b.points and r.user_id <> uid) + 1 as rank
    from base b where b.user_id = uid
  )
  select jsonb_build_object(
    'period', p_period,
    'week_start', (select week_start from public.leaderboard_totals limit 1),
    'month_start', (select month_start from public.leaderboard_totals limit 1),
    'refreshed_at', (select refreshed_at from public.leaderboard_state where id = 1),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
          'rank', r.rank, 'username', r.username, 'avatar_url', r.avatar_url,
          'level', (public.level_for(r.total) ->> 'level')::int, 'points', r.points,
          'is_me', r.user_id = uid
        ) order by r.pos)
      from ranked r where r.pos <= least(greatest(p_limit, 1), 100)
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object(
        'rank', case when m.points > 0 and not exists (
                       select 1 from public.user_moderation x
                       where x.user_id = uid and (x.leaderboard_banned or x.hidden)) then m.rank end,
        'points', coalesce(m.points, 0),
        'level', (public.level_for(coalesce(m.total, 0)) ->> 'level')::int,
        'username', p.username, 'avatar_url', p.avatar_url,
        'hidden', p.leaderboard_hidden,
        'removed', exists (select 1 from public.user_moderation x
                           where x.user_id = uid and (x.leaderboard_banned or x.hidden))
      )
      from public.profiles p left join me m on true where p.id = uid
    )
  ) into result;
  return result;
end $$;

-- My totals and level (always fresh, not from the view).
create or replace function public.my_points()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select public._points_week_start(public._points_day(now())) as week_start,
           date_trunc('month', public._points_day(now()))::date as month_start
  ),
  t as (
    select coalesce(sum(points), 0)::bigint as total,
      coalesce(sum(points) filter (where day >= b.week_start), 0)::bigint as week,
      coalesce(sum(points) filter (where day >= b.month_start), 0)::bigint as month
    from b left join public.points_ledger l on l.user_id = (select auth.uid())
    group by b.week_start, b.month_start
  )
  select jsonb_build_object(
    'total', t.total, 'week', t.week, 'month', t.month,
    'level', public.level_for(t.total),
    'under_review', (select count(*) from public.workout_flags f
                     where f.user_id = (select auth.uid()) and f.status = 'pending')
  )
  from t
$$;

-- The point values users see in "How points work" (no anti-cheat thresholds).
create or replace function public.points_rules()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workout_points', workout_points, 'min_working_sets', min_working_sets, 'set_points', set_points,
    'set_points_cap', set_points_cap, 'pr_points', pr_points, 'pr_cap', pr_cap, 'daily_cap', daily_cap,
    'weekly_goal_points', weekly_goal_points, 'goal_min_days', goal_min_days, 'goal_max_days', goal_max_days,
    'streak_points', streak_points, 'streak_cap_weeks', streak_cap_weeks, 'timezone', timezone
  )
  from public.points_settings where id = 1
$$;

-- Points for one of my workouts, its review status, and the level before and
-- after it (for the level-up moment).
create or replace function public.workout_points(p_workout uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  earned bigint;
  total bigint;
begin
  if not exists (select 1 from public.workouts where id = p_workout and user_id = uid) then
    return null;
  end if;
  select coalesce(sum(points), 0) into earned from public.points_ledger where user_id = uid and workout_id = p_workout;
  select coalesce(sum(points), 0) into total from public.points_ledger where user_id = uid;
  return jsonb_build_object(
    'review', (select case status when 'approved' then null else status end
               from public.workout_flags where workout_id = p_workout),
    'points', earned,
    'items', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'points', points, 'details', details)
                                        order by id)
                       from public.points_ledger where user_id = uid and workout_id = p_workout), '[]'::jsonb),
    'level_before', public.level_for(total - earned),
    'level_after', public.level_for(total)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Hooked into every workout save and delete (incl. offline sync).
-- ---------------------------------------------------------------------------
create or replace function public.after_workout_change(
  p_user_id uuid,
  p_workout_id uuid,
  p_previous_exercise_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.points_settings := (select x from public.points_settings x where id = 1);
  other uuid;
begin
  perform public.recompute_records(
    p_user_id,
    array(
      select unnest(coalesce(p_previous_exercise_ids, '{}'))
      union
      select exercise_id from public.workout_sets where workout_id = p_workout_id
      union
      select exercise_id from public.personal_records where user_id = p_user_id and workout_id = p_workout_id
    )
  );
  perform public._flag_workout(p_workout_id);
  -- "Too many today" depends on the other workouts that day: check again the
  -- days that are over the limit or had that flag (e.g. after a delete).
  for other in
    select w.id from public.workouts w
    where w.user_id = p_user_id and w.id <> p_workout_id and (
      public._points_day(w.started_at) in (
        select public._points_day(x.started_at) from public.workouts x where x.user_id = p_user_id
        group by 1 having count(*) > s.flag_max_workouts_per_day
      )
      or exists (select 1 from public.workout_flags f where f.workout_id = w.id
                 and f.reasons @> '[{"reason": "too_many_today"}]')
    )
  loop
    perform public._flag_workout(other);
  end loop;
  perform public.recompute_points(p_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin (checked and logged)
-- ---------------------------------------------------------------------------
create or replace function public.admin_points_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return (select to_jsonb(s) - 'id' from public.points_settings s where id = 1);
end $$;

-- Changing point values recalculates everyone's points (thresholds for flags
-- apply to workouts saved from now on).
create or replace function public.admin_update_points_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before jsonb := (select to_jsonb(s) from public.points_settings s where id = 1);
  merged public.points_settings;
  k text;
  u uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k in ('id', 'updated_at', 'timezone') or not before ? k then
      raise exception 'unknown setting %', k using errcode = '22023';
    end if;
  end loop;
  merged := jsonb_populate_record(null::public.points_settings, before || p_changes || jsonb_build_object('updated_at', now()));
  update public.points_settings set
    workout_points = merged.workout_points, min_working_sets = merged.min_working_sets,
    set_points = merged.set_points, set_points_cap = merged.set_points_cap,
    pr_points = merged.pr_points, pr_cap = merged.pr_cap, daily_cap = merged.daily_cap,
    weekly_goal_points = merged.weekly_goal_points, goal_min_days = merged.goal_min_days,
    goal_max_days = merged.goal_max_days, streak_points = merged.streak_points,
    streak_cap_weeks = merged.streak_cap_weeks, level_base = merged.level_base,
    level_exponent = merged.level_exponent, flag_min_minutes = merged.flag_min_minutes,
    flag_max_workouts_per_day = merged.flag_max_workouts_per_day,
    flag_backdate_days = merged.flag_backdate_days, flag_jump_pct = merged.flag_jump_pct,
    flag_jump_min_kg = merged.flag_jump_min_kg, flag_max_set_kg = merged.flag_max_set_kg,
    flag_default_bodyweight_kg = merged.flag_default_bodyweight_kg,
    weight_ratios = merged.weight_ratios, equipment_factors = merged.equipment_factors,
    updated_at = now()
  where id = 1;
  perform public.log_admin_action('points.settings', 'points_settings', '1', jsonb_build_object(
    'changes', p_changes,
    'before', (select jsonb_object_agg(key, before -> key) from jsonb_object_keys(p_changes) key)
  ));
  for u in select distinct user_id from public.workouts loop
    perform public.recompute_points(u);
  end loop;
  return public.admin_points_settings();
end $$;

create or replace function public.admin_flagged_workouts(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'workout_id', f.workout_id, 'status', f.status, 'reasons', f.reasons,
        'flagged_at', f.created_at, 'reviewed_at', f.reviewed_at,
        'user_id', f.user_id, 'username', p.username, 'display_name', p.display_name,
        'bodyweight_kg', p.bodyweight_kg,
        'name', w.name, 'started_at', w.started_at, 'duration_seconds', w.duration_seconds,
        'logged_at', w.created_at,
        'sets', (
          select coalesce(jsonb_agg(jsonb_build_object(
              'exercise', e.name, 'set_type', s.set_type, 'weight_kg', s.weight_kg, 'reps', s.reps,
              'duration_seconds', s.duration_seconds, 'distance_m', s.distance_m
            ) order by s.exercise_order, s.set_order), '[]'::jsonb)
          from public.workout_sets s join public.exercises e on e.id = s.exercise_id
          where s.workout_id = w.id
        )
      ) order by f.created_at desc)
    from public.workout_flags f
    join public.workouts w on w.id = f.workout_id
    left join public.profiles p on p.id = f.user_id
    where p_status = 'all' or f.status = p_status
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_review_workout(p_workout uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.workout_flags
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
  where workout_id = p_workout
  returning user_id into owner;
  if owner is null then raise exception 'no flag for workout %', p_workout using errcode = 'P0002'; end if;
  perform public.log_admin_action(case when p_approve then 'points.approve' else 'points.reject' end,
    'workout', p_workout::text, jsonb_build_object('user_id', owner));
  perform public.recompute_points(owner);
end $$;

create or replace function public.admin_users(p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.total desc, x.username)
    from (
      select p.username, coalesce(sum(l.points), 0) as total, jsonb_build_object(
        'user_id', p.id, 'username', p.username, 'display_name', p.display_name, 'email', u.email,
        'avatar_url', p.avatar_url, 'points', coalesce(sum(l.points), 0),
        'level', (public.level_for(coalesce(sum(l.points), 0)) ->> 'level')::int,
        'self_hidden', p.leaderboard_hidden,
        'leaderboard_banned', coalesce(m.leaderboard_banned, false), 'hidden', coalesce(m.hidden, false),
        'note', m.note,
        'pending_flags', (select count(*) from public.workout_flags f where f.user_id = p.id and f.status = 'pending')
      ) as j
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.user_moderation m on m.user_id = p.id
      left join public.points_ledger l on l.user_id = p.id
      where btrim(coalesce(p_query, '')) = ''
         or p.username ilike '%' || btrim(p_query) || '%'
         or p.display_name ilike '%' || btrim(p_query) || '%'
         or u.email ilike '%' || btrim(p_query) || '%'
      group by p.id, u.email, m.user_id
      order by coalesce(sum(l.points), 0) desc
      limit 100
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_user_moderation(
  p_user uuid,
  p_leaderboard_banned boolean,
  p_hidden boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before jsonb;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'user % not found', p_user using errcode = 'P0002';
  end if;
  select to_jsonb(m) - 'user_id' - 'updated_by' - 'updated_at' into before from public.user_moderation m where user_id = p_user;
  insert into public.user_moderation (user_id, leaderboard_banned, hidden, note, updated_by)
  values (p_user, p_leaderboard_banned, p_hidden, nullif(btrim(p_note), ''), (select auth.uid()))
  on conflict (user_id) do update set
    leaderboard_banned = excluded.leaderboard_banned, hidden = excluded.hidden,
    note = coalesce(excluded.note, public.user_moderation.note),
    updated_by = excluded.updated_by, updated_at = now();
  perform public.log_admin_action('user.moderation', 'user', p_user::text, jsonb_build_object(
    'leaderboard_banned', p_leaderboard_banned, 'hidden', p_hidden, 'note', p_note, 'before', before));
end $$;

-- Why someone has their points: the ledger with workout names.
create or replace function public.admin_user_ledger(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'points', l.points, 'reason', l.reason, 'source_type', l.source_type, 'source_id', l.source_id,
        'workout', w.name, 'earned_at', l.earned_at, 'day', l.day, 'details', l.details
      ) order by l.earned_at desc, l.id desc)
    from (select * from public.points_ledger where user_id = p_user order by earned_at desc limit 300) l
    left join public.workouts w on w.id = l.workout_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Points for workouts saved before this stage. Skips users who already have
-- points; nothing is flagged for old workouts (only new saves are checked).
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid;
begin
  for u in
    select distinct w.user_id from public.workouts w
    where not exists (select 1 from public.points_ledger l where l.user_id = w.user_id)
  loop
    perform public.recompute_points(u);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._points_day(timestamptz)', 'public._points_week_start(date)', 'public._workout_counts(uuid)',
    'public._flag_workout(uuid)', 'public.recompute_points(uuid)', 'public._refresh_leaderboard()',
    'public._on_leaderboards(uuid)', 'public.after_workout_change(uuid, uuid, uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.level_for(bigint)', 'public.leaderboard(text, integer)', 'public.my_points()',
    'public.points_rules()',
    'public.workout_points(uuid)', 'public.admin_points_settings()',
    'public.admin_update_points_settings(jsonb)', 'public.admin_flagged_workouts(text)',
    'public.admin_review_workout(uuid, boolean)', 'public.admin_users(text)',
    'public.admin_set_user_moderation(uuid, boolean, boolean, text)', 'public.admin_user_ledger(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
