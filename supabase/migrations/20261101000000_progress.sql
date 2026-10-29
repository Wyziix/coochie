-- Stage 4: personal records (server-computed), chart data, weekly overview,
-- body measurements, progress photos.
--
-- idempotent: safe to run again if a previous run stopped halfway.

-- ---------------------------------------------------------------------------
-- Personal records. Derived data: always recomputed from workout_sets by
-- recompute_records(), never written by clients.
-- ---------------------------------------------------------------------------
do $$
begin
  create type public.record_type as enum (
    'heaviest_weight',  -- heaviest working set (any reps)
    'best_e1rm',        -- best estimated 1RM, Epley: w × (1 + reps/30), reps 1–12
    'reps_at_weight',   -- most reps at one weight (bucket_kg); bodyweight sets use 0
    'session_volume',   -- most weight × reps for this exercise in one workout
    'longest_duration'  -- timed exercises
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.personal_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  record_type public.record_type not null,
  bucket_kg numeric(6, 2) not null default 0,
  value numeric(10, 2) not null,
  weight_kg numeric(6, 2),
  reps smallint,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  set_id uuid,
  achieved_at timestamptz not null,
  -- Best value before this record was set (null = first time).
  previous_value numeric(10, 2)
);

create unique index if not exists personal_records_key
  on public.personal_records (user_id, exercise_id, record_type, bucket_kg);
create index if not exists personal_records_workout_idx on public.personal_records (workout_id);

alter table public.personal_records enable row level security;

drop policy if exists "personal_records: read own" on public.personal_records;
create policy "personal_records: read own"
on public.personal_records for select
to authenticated
using (user_id = (select auth.uid()));
-- No write policies.

-- Recomputes every record of one user for the given exercises from scratch.
-- Ties go to the earliest set, so equalling a record isn't a new one.
create or replace function public.recompute_records(p_user_id uuid, p_exercise_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_exercise_ids is null or cardinality(p_exercise_ids) = 0 then
    return;
  end if;

  delete from public.personal_records
  where user_id = p_user_id and exercise_id = any (p_exercise_ids);

  insert into public.personal_records (
    user_id, exercise_id, record_type, bucket_kg, value, weight_kg, reps,
    workout_id, set_id, achieved_at, previous_value
  )
  with s as (
    select ws.id, ws.workout_id, ws.exercise_id, ws.exercise_order, ws.set_order,
           ws.weight_kg, ws.reps, ws.duration_seconds, w.started_at
    from public.workout_sets ws
    join public.workouts w on w.id = ws.workout_id
    where ws.user_id = p_user_id
      and ws.exercise_id = any (p_exercise_ids)
      and ws.set_type <> 'warmup'
  ),
  e1 as (
    select s.*, case when s.reps = 1 then s.weight_kg else s.weight_kg * (1 + s.reps / 30.0) end as e1rm
    from s where s.weight_kg > 0 and s.reps between 1 and 12
  ),
  sess as (
    select exercise_id, workout_id, min(started_at) as started_at, sum(weight_kg * reps) as volume
    from s where weight_kg > 0 and reps >= 1
    group by exercise_id, workout_id
  ),
  heaviest as (
    select distinct on (exercise_id) * from s
    where weight_kg > 0 and reps >= 1
    order by exercise_id, weight_kg desc, started_at, exercise_order, set_order
  ),
  best_e1 as (
    select distinct on (exercise_id) * from e1
    order by exercise_id, e1rm desc, started_at, exercise_order, set_order
  ),
  reps_w as (
    select distinct on (exercise_id, coalesce(weight_kg, 0)) s.*, coalesce(weight_kg, 0) as bucket
    from s where reps >= 1
    order by exercise_id, coalesce(weight_kg, 0), reps desc, started_at, exercise_order, set_order
  ),
  best_sess as (
    select distinct on (exercise_id) * from sess
    order by exercise_id, volume desc, started_at
  ),
  longest as (
    select distinct on (exercise_id) * from s
    where duration_seconds > 0
    order by exercise_id, duration_seconds desc, started_at, exercise_order, set_order
  )
  select p_user_id, h.exercise_id, 'heaviest_weight'::public.record_type, 0, h.weight_kg, h.weight_kg, h.reps,
         h.workout_id, h.id, h.started_at,
         (select max(x.weight_kg) from s x
          where x.exercise_id = h.exercise_id and x.reps >= 1 and x.started_at < h.started_at)
  from heaviest h
  union all
  select p_user_id, b.exercise_id, 'best_e1rm', 0, round(b.e1rm, 2), b.weight_kg, b.reps,
         b.workout_id, b.id, b.started_at,
         (select round(max(x.e1rm), 2) from e1 x
          where x.exercise_id = b.exercise_id and x.started_at < b.started_at)
  from best_e1 b
  union all
  select p_user_id, r.exercise_id, 'reps_at_weight', r.bucket, r.reps, r.weight_kg, r.reps,
         r.workout_id, r.id, r.started_at,
         (select max(x.reps) from s x
          where x.exercise_id = r.exercise_id and coalesce(x.weight_kg, 0) = r.bucket
            and x.started_at < r.started_at)
  from reps_w r
  union all
  select p_user_id, v.exercise_id, 'session_volume', 0, round(v.volume, 2), null, null,
         v.workout_id, null, v.started_at,
         (select round(max(x.volume), 2) from sess x
          where x.exercise_id = v.exercise_id and x.started_at < v.started_at)
  from best_sess v
  union all
  select p_user_id, d.exercise_id, 'longest_duration', 0, d.duration_seconds, null, null,
         d.workout_id, d.id, d.started_at,
         (select max(x.duration_seconds) from s x
          where x.exercise_id = d.exercise_id and x.started_at < d.started_at)
  from longest d;
end;
$$;

revoke execute on function public.recompute_records(uuid, uuid[]) from public, anon, authenticated;

-- Called by save_workout / delete_workout. p_previous_exercise_ids = the
-- exercises the workout had *before* the change, so records of exercises that
-- were removed (or a deleted workout) are recomputed too and the previous
-- best becomes the record again.
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
  -- Stage 8 (points) hooks in here too.
end;
$$;

revoke execute on function public.after_workout_change(uuid, uuid, uuid[]) from public, anon, authenticated;

-- save_workout v3: same as v2, plus remembers the exercises the workout had
-- before an edit and passes them on.
create or replace function public.save_workout(p_workout jsonb, p_sets jsonb)
returns public.workouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  wid uuid := (p_workout ->> 'id')::uuid;
  started timestamptz := (p_workout ->> 'started_at')::timestamptz;
  ended timestamptz := (p_workout ->> 'ended_at')::timestamptz;
  tid uuid := nullif(p_workout ->> 'template_id', '')::uuid;
  result public.workouts;
  bad_exercise uuid;
  previous_exercises uuid[];
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from public.workouts where id = wid and user_id <> uid) then
    raise exception 'workout belongs to someone else' using errcode = '42501';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'a workout needs at least one completed set' using errcode = '22023';
  end if;
  if started > now() + interval '1 day' then
    raise exception 'workout can''t start in the future' using errcode = '22023';
  end if;

  select (s ->> 'exercise_id')::uuid into bad_exercise
  from jsonb_array_elements(p_sets) s
  where not exists (
    select 1 from public.exercises x
    where x.id = (s ->> 'exercise_id')::uuid and (x.owner_id is null or x.owner_id = uid)
  )
  limit 1;
  if bad_exercise is not null then
    raise exception 'exercise % not available', bad_exercise using errcode = '23503';
  end if;

  if tid is not null and not exists (
    select 1 from public.templates t where t.id = tid and (t.owner_id is null or t.owner_id = uid)
  ) then
    tid := null;
  end if;

  previous_exercises := array(select distinct exercise_id from public.workout_sets where workout_id = wid);

  insert into public.workouts as w (id, user_id, name, started_at, ended_at, duration_seconds, notes, template_id)
  values (
    wid, uid, btrim(p_workout ->> 'name'), started, ended,
    floor(extract(epoch from (ended - started)))::integer,
    nullif(btrim(p_workout ->> 'notes'), ''),
    tid
  )
  on conflict (id) do update set
    name = excluded.name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_seconds = excluded.duration_seconds,
    notes = excluded.notes,
    template_id = coalesce(excluded.template_id, w.template_id)
  returning * into result;

  delete from public.workout_sets where workout_id = result.id;

  insert into public.workout_sets (
    id, workout_id, user_id, exercise_id, exercise_order, set_order, set_type,
    weight_kg, reps, rpe, duration_seconds, distance_m
  )
  select s.id, result.id, uid, s.exercise_id, s.exercise_order, s.set_order,
         coalesce(s.set_type, 'normal'), s.weight_kg, s.reps, s.rpe, s.duration_seconds, s.distance_m
  from jsonb_to_recordset(p_sets) as s(
    id uuid, exercise_id uuid, exercise_order smallint, set_order smallint, set_type public.set_type,
    weight_kg numeric, reps smallint, rpe numeric, duration_seconds integer, distance_m numeric
  );

  update public.workouts set total_volume_kg = coalesce((
    select round(sum(weight_kg * reps), 2) from public.workout_sets
    where workout_id = result.id and set_type <> 'warmup'
  ), 0)
  where id = result.id
  returning * into result;

  perform public.after_workout_change(uid, result.id, previous_exercises);
  return result;
end;
$$;

create or replace function public.delete_workout(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  previous_exercises uuid[];
begin
  previous_exercises := array(
    select distinct exercise_id from public.workout_sets where workout_id = p_id and user_id = uid
  );
  delete from public.workouts where id = p_id and user_id = uid;
  if not found then
    raise exception 'workout % not found', p_id using errcode = 'P0002';
  end if;
  -- The workout's records went with it (on delete cascade); recompute so the
  -- previous best takes over.
  perform public.after_workout_change(uid, p_id, previous_exercises);
end;
$$;

-- The Stage 3 two-argument version is no longer called.
drop function if exists public.after_workout_change(uuid, uuid);

-- New records set by one workout, for the celebration screen. Only real
-- improvements: something done before, beaten now.
create or replace function public.workout_records(p_workout_id uuid)
returns table (
  exercise_id uuid,
  exercise_name text,
  exercise_type public.exercise_type,
  record_type public.record_type,
  value numeric,
  previous_value numeric,
  weight_kg numeric,
  reps smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pr.exercise_id, e.name, e.type, pr.record_type, pr.value, pr.previous_value, pr.weight_kg, pr.reps
  from public.personal_records pr
  join public.exercises e on e.id = pr.exercise_id
  where pr.workout_id = p_workout_id
    and pr.user_id = (select auth.uid())
    and pr.previous_value is not null
    and pr.value > pr.previous_value
  order by (select min(ws.exercise_order) from public.workout_sets ws
            where ws.workout_id = p_workout_id and ws.exercise_id = pr.exercise_id),
           pr.record_type, pr.bucket_kg desc;
$$;

revoke execute on function public.workout_records(uuid) from public, anon;
grant execute on function public.workout_records(uuid) to authenticated;

-- Per-workout numbers for one exercise, for the charts.
create or replace function public.exercise_history(p_exercise_id uuid, p_since timestamptz default null)
returns table (
  workout_id uuid,
  started_at timestamptz,
  max_weight_kg numeric,
  best_e1rm_kg numeric,
  volume_kg numeric,
  total_reps integer,
  max_duration_seconds integer,
  total_distance_m numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select w.id, w.started_at,
         max(s.weight_kg) filter (where s.reps >= 1 and s.weight_kg > 0),
         round(max(case when s.reps = 1 then s.weight_kg else s.weight_kg * (1 + s.reps / 30.0) end)
               filter (where s.weight_kg > 0 and s.reps between 1 and 12), 2),
         coalesce(round(sum(s.weight_kg * s.reps) filter (where s.weight_kg > 0 and s.reps >= 1), 2), 0),
         coalesce(sum(s.reps), 0)::integer,
         max(s.duration_seconds),
         sum(s.distance_m)
  from public.workout_sets s
  join public.workouts w on w.id = s.workout_id
  where s.user_id = (select auth.uid())
    and s.exercise_id = p_exercise_id
    and s.set_type <> 'warmup'
    and (p_since is null or w.started_at >= p_since)
  group by w.id, w.started_at
  order by w.started_at;
$$;

revoke execute on function public.exercise_history(uuid, timestamptz) from public, anon;
grant execute on function public.exercise_history(uuid, timestamptz) to authenticated;

-- Exercises the user has logged, most recent first, for the Progress tab.
create or replace function public.trained_exercises()
returns table (
  exercise_id uuid,
  name text,
  type public.exercise_type,
  primary_muscle public.muscle_group,
  sessions integer,
  last_performed timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.name, e.type, e.primary_muscle, count(distinct s.workout_id)::integer, max(w.started_at)
  from public.workout_sets s
  join public.workouts w on w.id = s.workout_id
  join public.exercises e on e.id = s.exercise_id
  where s.user_id = (select auth.uid())
  group by e.id, e.name, e.type, e.primary_muscle
  order by max(w.started_at) desc;
$$;

revoke execute on function public.trained_exercises() from public, anon;
grant execute on function public.trained_exercises() to authenticated;

-- Home screen: workouts, volume and muscles trained in [p_from, p_to).
-- Muscles count working sets: primary muscle 1, each secondary 0.5.
create or replace function public.weekly_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with w as (
    select * from public.workouts
    where user_id = (select auth.uid()) and started_at >= p_from and started_at < p_to
  ),
  s as (
    select ws.*, e.primary_muscle, e.secondary_muscles
    from public.workout_sets ws
    join w on w.id = ws.workout_id
    join public.exercises e on e.id = ws.exercise_id
    where ws.set_type <> 'warmup'
  ),
  m as (
    select muscle, sum(weight) as sets from (
      select primary_muscle as muscle, 1.0 as weight from s
      union all
      select unnest(secondary_muscles), 0.5 from s
    ) x
    group by muscle
  )
  select jsonb_build_object(
    'workouts', (select count(*) from w),
    'volume_kg', (select coalesce(sum(total_volume_kg), 0) from w),
    'duration_seconds', (select coalesce(sum(duration_seconds), 0) from w),
    'sets', (select count(*) from s),
    'muscles', (select coalesce(jsonb_agg(jsonb_build_object('muscle', muscle, 'sets', sets) order by sets desc, muscle), '[]'::jsonb) from m)
  );
$$;

revoke execute on function public.weekly_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.weekly_overview(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Body measurements. One entry per day; the newest bodyweight is copied to
-- profiles.bodyweight_kg by a trigger.
-- ---------------------------------------------------------------------------
create table if not exists public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_on date not null default current_date,
  bodyweight_kg numeric(5, 2),
  body_fat_pct numeric(4, 1),
  neck_cm numeric(5, 1),
  shoulders_cm numeric(5, 1),
  chest_cm numeric(5, 1),
  waist_cm numeric(5, 1),
  hips_cm numeric(5, 1),
  arm_cm numeric(5, 1),
  thigh_cm numeric(5, 1),
  calf_cm numeric(5, 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint body_measurements_bodyweight_range check (bodyweight_kg between 20 and 400),
  constraint body_measurements_fat_range check (body_fat_pct between 2 and 70),
  constraint body_measurements_cm_range check (
    coalesce(neck_cm, 50) between 10 and 300 and coalesce(shoulders_cm, 50) between 10 and 300
    and coalesce(chest_cm, 50) between 10 and 300 and coalesce(waist_cm, 50) between 10 and 300
    and coalesce(hips_cm, 50) between 10 and 300 and coalesce(arm_cm, 50) between 10 and 300
    and coalesce(thigh_cm, 50) between 10 and 300 and coalesce(calf_cm, 50) between 10 and 300
  ),
  constraint body_measurements_notes_length check (char_length(notes) <= 500),
  constraint body_measurements_not_future check (measured_on <= current_date + 1),
  constraint body_measurements_not_empty check (
    num_nonnulls(bodyweight_kg, body_fat_pct, neck_cm, shoulders_cm, chest_cm, waist_cm,
                 hips_cm, arm_cm, thigh_cm, calf_cm) > 0
  )
);

create unique index if not exists body_measurements_day_key on public.body_measurements (user_id, measured_on);

drop trigger if exists body_measurements_set_updated_at on public.body_measurements;
create trigger body_measurements_set_updated_at
before update on public.body_measurements
for each row execute function public.set_updated_at();

alter table public.body_measurements enable row level security;

drop policy if exists "body_measurements: own" on public.body_measurements;
create policy "body_measurements: own"
on public.body_measurements for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create or replace function public.sync_profile_bodyweight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := coalesce(new.user_id, old.user_id);
  latest numeric;
begin
  select bodyweight_kg into latest
  from public.body_measurements
  where user_id = uid and bodyweight_kg is not null
  order by measured_on desc, updated_at desc
  limit 1;
  -- No entries left: keep whatever the profile had.
  if latest is not null then
    update public.profiles set bodyweight_kg = latest
    where id = uid and bodyweight_kg is distinct from latest;
  end if;
  return null;
end;
$$;

drop trigger if exists body_measurements_sync_profile on public.body_measurements;
create trigger body_measurements_sync_profile
after insert or update or delete on public.body_measurements
for each row execute function public.sync_profile_bodyweight();

-- Start everyone's log with the bodyweight from onboarding.
insert into public.body_measurements (user_id, measured_on, bodyweight_kg)
select p.id, coalesce(p.onboarding_completed_at, p.created_at)::date, p.bodyweight_kg
from public.profiles p
where p.bodyweight_kg is not null
  and not exists (select 1 from public.body_measurements b where b.user_id = p.id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Progress photos: private bucket, files at progress-photos/<user id>/<id>.jpg.
-- ---------------------------------------------------------------------------
create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  taken_on date not null default current_date,
  storage_path text not null unique,
  width integer,
  height integer,
  pose text not null default 'front',
  notes text,
  created_at timestamptz not null default now(),

  constraint progress_photos_pose check (pose in ('front', 'side', 'back', 'other')),
  constraint progress_photos_own_folder check (storage_path like user_id::text || '/%'),
  constraint progress_photos_notes_length check (char_length(notes) <= 500),
  constraint progress_photos_not_future check (taken_on <= current_date + 1)
);

create index if not exists progress_photos_user_idx on public.progress_photos (user_id, taken_on desc);

alter table public.progress_photos enable row level security;

-- Skipped once the photo lock (20261102000000_photo_lock.sql) is applied: it
-- removes direct access, and re-running this file must not bring it back.
do $do$
begin
  if to_regclass('public.photo_locks') is null then
    execute $p$drop policy if exists "progress_photos: own" on public.progress_photos$p$;
    execute $p$create policy "progress_photos: own"
on public.progress_photos for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()))$p$;
  end if;
end $do$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

-- Skipped once the photo lock (20261102000000_photo_lock.sql) is applied: it
-- removes direct access, and re-running this file must not bring it back.
do $do$
begin
  if to_regclass('public.photo_locks') is null then
    execute $p$drop policy if exists "progress-photos: read own folder" on storage.objects$p$;
    execute $p$create policy "progress-photos: read own folder"
on storage.objects for select
to authenticated
using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$drop policy if exists "progress-photos: upload to own folder" on storage.objects$p$;
    execute $p$create policy "progress-photos: upload to own folder"
on storage.objects for insert
to authenticated
with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$drop policy if exists "progress-photos: update own folder" on storage.objects$p$;
    execute $p$create policy "progress-photos: update own folder"
on storage.objects for update
to authenticated
using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$drop policy if exists "progress-photos: delete own folder" on storage.objects$p$;
    execute $p$create policy "progress-photos: delete own folder"
on storage.objects for delete
to authenticated
using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Records for workouts logged before this migration.
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in select user_id, array_agg(distinct exercise_id) as ids from public.workout_sets group by user_id loop
    perform public.recompute_records(u.user_id, u.ids);
  end loop;
end $$;
