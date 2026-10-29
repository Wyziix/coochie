-- Stage 5: offline sync.
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- Workouts and templates edited offline reach the server late, so "last write
-- wins" compares the time the change was made on the device
-- (client_updated_at), not the time it arrived (updated_at).
-- Deletes leave a tombstone so a late, older edit can't bring them back.
-- Saves and deletes stay idempotent: the app retries with the same ids.

alter table public.workouts add column if not exists client_updated_at timestamptz;
alter table public.templates add column if not exists client_updated_at timestamptz;

create table if not exists public.sync_tombstones (
  entity text not null,
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  deleted_at timestamptz not null,
  primary key (entity, id),

  constraint sync_tombstones_entity check (entity in ('workout', 'template'))
);
alter table public.sync_tombstones enable row level security;
revoke all on public.sync_tombstones from anon, authenticated;

-- When the change was made: the device's time, but never later than now (a
-- phone with a wrong clock must not win every conflict forever).
create or replace function public._change_time(p_value text)
returns timestamptz
language sql
stable
set search_path = ''
as $$ select least(coalesce(nullif(p_value, '')::timestamptz, now()), now()) $$;

revoke all on function public._change_time(text) from public, anon, authenticated;

create or replace function public._tombstone(p_entity text, p_id uuid, p_user uuid, p_at timestamptz)
returns void
language sql
set search_path = ''
as $$
  insert into public.sync_tombstones (entity, id, user_id, deleted_at)
  values (p_entity, p_id, p_user, p_at)
  on conflict (entity, id) do update
    set deleted_at = greatest(public.sync_tombstones.deleted_at, excluded.deleted_at)
    where public.sync_tombstones.user_id = excluded.user_id
$$;

revoke all on function public._tombstone(text, uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_workout v4: v3 (Stage 4) plus last-write-wins. Returns the stored row:
-- the existing one if this change is older, or null if the workout was
-- deleted after this change was made.
-- ---------------------------------------------------------------------------
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
  changed timestamptz := public._change_time(p_workout ->> 'client_updated_at');
  existing public.workouts;
  result public.workouts;
  bad_exercise uuid;
  previous_exercises uuid[];
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into existing from public.workouts where id = wid;
  if found and existing.user_id <> uid then
    raise exception 'workout belongs to someone else' using errcode = '42501';
  end if;

  -- Last write wins.
  if exists (
    select 1 from public.sync_tombstones t
    where t.entity = 'workout' and t.id = wid and t.user_id = uid and t.deleted_at >= changed
  ) then
    return null;
  end if;
  if existing.id is not null and existing.client_updated_at > changed then
    return existing;
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

  insert into public.workouts as w (id, user_id, name, started_at, ended_at, duration_seconds, notes, template_id, client_updated_at)
  values (
    wid, uid, btrim(p_workout ->> 'name'), started, ended,
    floor(extract(epoch from (ended - started)))::integer,
    nullif(btrim(p_workout ->> 'notes'), ''),
    tid,
    changed
  )
  on conflict (id) do update set
    name = excluded.name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_seconds = excluded.duration_seconds,
    notes = excluded.notes,
    template_id = coalesce(excluded.template_id, w.template_id),
    client_updated_at = excluded.client_updated_at
  returning * into result;

  -- Saved again after an older delete: it's back.
  delete from public.sync_tombstones where entity = 'workout' and id = wid and user_id = uid;

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

-- Delete with the time it was done on the device. A workout edited after that
-- time is kept. Deleting something already gone is fine (retries).
create or replace function public.delete_workout_at(p_id uuid, p_deleted_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed timestamptz := public._change_time(p_deleted_at::text);
  existing public.workouts;
  previous_exercises uuid[];
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into existing from public.workouts where id = p_id;
  if found and existing.user_id <> uid then
    raise exception 'workout % not found', p_id using errcode = 'P0002';
  end if;
  if found then
    if existing.client_updated_at > changed then
      return;
    end if;
    previous_exercises := array(
      select distinct exercise_id from public.workout_sets where workout_id = p_id
    );
    delete from public.workouts where id = p_id;
    -- The workout's records went with it (on delete cascade); recompute so the
    -- previous best takes over.
    perform public.after_workout_change(uid, p_id, previous_exercises);
  end if;
  perform public._tombstone('workout', p_id, uid, changed);
end;
$$;

-- Same signature as before (the app's online path and older versions).
create or replace function public.delete_workout(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ select public.delete_workout_at(p_id, now()) $$;

revoke execute on function public.delete_workout_at(uuid, timestamptz) from public, anon;
grant execute on function public.delete_workout_at(uuid, timestamptz) to authenticated;
revoke execute on function public.delete_workout(uuid) from public, anon;
grant execute on function public.delete_workout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Templates: the app picks the id of a new template (so a retried create
-- doesn't make two), plus last-write-wins and tombstones like workouts.
-- ---------------------------------------------------------------------------
create or replace function public.save_template(p_id uuid, p_template jsonb, p_exercises jsonb)
returns public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed timestamptz := public._change_time(p_template ->> 'client_updated_at');
  existing public.templates;
  result public.templates;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if p_id is not null then
    if exists (
      select 1 from public.sync_tombstones t
      where t.entity = 'template' and t.id = p_id and t.user_id = uid and t.deleted_at >= changed
    ) then
      return null;
    end if;
    select * into existing from public.templates where id = p_id;
    if found then
      if existing.owner_id is distinct from uid then
        raise exception 'template % not found', p_id using errcode = 'P0002';
      end if;
      if existing.client_updated_at > changed then
        return existing;
      end if;
    else
      -- New template with the app's id; write_template fills it in below
      -- (and its checks roll this back if the template isn't valid).
      insert into public.templates (id, owner_id, name)
      values (p_id, uid, coalesce(nullif(btrim(p_template ->> 'name'), ''), 'Template'));
    end if;
  end if;

  -- Users can't set a program (that's for ready-made templates).
  result := public.write_template(p_id, uid, p_template - 'program' - 'position', p_exercises);
  update public.templates set client_updated_at = changed where id = result.id returning * into result;
  delete from public.sync_tombstones where entity = 'template' and id = result.id and user_id = uid;
  return result;
end;
$$;

revoke execute on function public.save_template(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_template(uuid, jsonb, jsonb) to authenticated;

create or replace function public.delete_template(p_id uuid, p_deleted_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed timestamptz := public._change_time(p_deleted_at::text);
  existing public.templates;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into existing from public.templates where id = p_id;
  if found then
    if existing.owner_id is distinct from uid then
      raise exception 'template % not found', p_id using errcode = 'P0002';
    end if;
    if existing.client_updated_at > changed then
      return;
    end if;
    delete from public.templates where id = p_id;
  end if;
  perform public._tombstone('template', p_id, uid, changed);
end;
$$;

revoke execute on function public.delete_template(uuid, timestamptz) from public, anon;
grant execute on function public.delete_template(uuid, timestamptz) to authenticated;
