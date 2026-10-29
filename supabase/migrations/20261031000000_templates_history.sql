-- Stage 3: workout templates, ready-made programs, and server-only workout
-- writes (edit/delete recalculate on the server).

-- ---------------------------------------------------------------------------
-- Workouts: clients may only read. Every write goes through save_workout /
-- delete_workout, which compute duration and volume themselves, so a client
-- can never store its own totals (PRs in Stage 4 and points in Stage 8 build
-- on these numbers).
-- ---------------------------------------------------------------------------
drop policy "workouts: own" on public.workouts;
create policy "workouts: read own"
on public.workouts for select
to authenticated
using (user_id = (select auth.uid()));

drop policy "workout_sets: write own" on public.workout_sets;
drop policy "workout_sets: update own" on public.workout_sets;
drop policy "workout_sets: delete own" on public.workout_sets;

-- Called by every workout write after the change. Stage 4 (personal records)
-- and Stage 8 (points) recompute their data for this user here, so edits and
-- deletes of past workouts stay consistent. No-op for now.
create or replace function public.after_workout_change(p_user_id uuid, p_workout_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke execute on function public.after_workout_change(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Templates. owner_id null = ready-made (managed by admins).
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null,
  notes text,
  program text,
  position smallint not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint templates_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint templates_notes_length check (char_length(notes) <= 1000),
  constraint templates_program_length check (char_length(program) <= 60)
);

create index templates_owner_idx on public.templates (owner_id);

create trigger templates_set_updated_at
before update on public.templates
for each row execute function public.set_updated_at();

create table public.template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position smallint not null,
  target_sets smallint not null default 3,
  target_reps_min smallint,
  target_reps_max smallint,
  target_duration_seconds integer,
  rest_seconds integer,

  constraint template_exercises_sets_range check (target_sets between 1 and 20),
  constraint template_exercises_reps_range check (
    (target_reps_min is null or target_reps_min between 1 and 100)
    and (target_reps_max is null or target_reps_max between 1 and 100)
    and (target_reps_max is null or target_reps_min is null or target_reps_max >= target_reps_min)
  ),
  constraint template_exercises_duration_range check (target_duration_seconds between 1 and 86400),
  constraint template_exercises_rest_range check (rest_seconds between 0 and 900)
);

create index template_exercises_template_idx on public.template_exercises (template_id, position);

alter table public.templates enable row level security;
alter table public.template_exercises enable row level security;

-- Users see ready-made (unless hidden) and their own; admins also see hidden ones.
create policy "templates: read ready-made and own"
on public.templates for select
to authenticated
using (
  owner_id = (select auth.uid())
  or (owner_id is null and (not is_hidden or (select public.is_admin())))
);

create policy "templates: delete own"
on public.templates for delete
to authenticated
using (owner_id = (select auth.uid()));

create policy "template_exercises: read visible templates"
on public.template_exercises for select
to authenticated
using (exists (select 1 from public.templates t where t.id = template_id));

-- No insert/update policies: templates are written by save_template (own) and
-- admin_save_template (ready-made), which validate everything first.

-- Workouts remember which template they came from.
alter table public.workouts
  add column template_id uuid references public.templates (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Shared template writer. Validates and replaces the exercise list. Only
-- called from the security definer functions below.
-- ---------------------------------------------------------------------------
create or replace function public.write_template(
  p_template_id uuid,
  p_owner_id uuid,
  p_template jsonb,
  p_exercises jsonb
)
returns public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.templates;
  bad_exercise uuid;
begin
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' or jsonb_array_length(p_exercises) = 0 then
    raise exception 'a template needs at least one exercise' using errcode = '22023';
  end if;
  if jsonb_array_length(p_exercises) > 30 then
    raise exception 'a template can have at most 30 exercises' using errcode = '22023';
  end if;

  -- Each exercise must be global or the owner's own custom one.
  select (e ->> 'exercise_id')::uuid into bad_exercise
  from jsonb_array_elements(p_exercises) e
  where not exists (
    select 1 from public.exercises x
    where x.id = (e ->> 'exercise_id')::uuid
      and (x.owner_id is null or x.owner_id = p_owner_id)
  )
  limit 1;
  if bad_exercise is not null then
    raise exception 'exercise % not available', bad_exercise using errcode = '23503';
  end if;

  if p_template_id is null then
    insert into public.templates (owner_id, name, notes, program, position)
    values (
      p_owner_id,
      btrim(p_template ->> 'name'),
      nullif(btrim(p_template ->> 'notes'), ''),
      nullif(btrim(p_template ->> 'program'), ''),
      coalesce((p_template ->> 'position')::smallint, 0)
    )
    returning * into result;
  else
    update public.templates set
      name = btrim(p_template ->> 'name'),
      notes = nullif(btrim(p_template ->> 'notes'), ''),
      program = nullif(btrim(p_template ->> 'program'), ''),
      position = coalesce((p_template ->> 'position')::smallint, position)
    where id = p_template_id
      and owner_id is not distinct from p_owner_id
    returning * into result;
    if result.id is null then
      raise exception 'template % not found', p_template_id using errcode = 'P0002';
    end if;
    delete from public.template_exercises where template_id = result.id;
  end if;

  insert into public.template_exercises (
    template_id, exercise_id, position, target_sets, target_reps_min, target_reps_max,
    target_duration_seconds, rest_seconds
  )
  select result.id, (e ->> 'exercise_id')::uuid, (ord - 1)::smallint,
         coalesce((e ->> 'target_sets')::smallint, 3),
         (e ->> 'target_reps_min')::smallint, (e ->> 'target_reps_max')::smallint,
         (e ->> 'target_duration_seconds')::integer, (e ->> 'rest_seconds')::integer
  from jsonb_array_elements(p_exercises) with ordinality as x(e, ord);

  -- Touch updated_at even when only exercises changed.
  update public.templates set updated_at = now() where id = result.id returning * into result;
  return result;
end;
$$;

revoke execute on function public.write_template(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- The user's own templates.
create or replace function public.save_template(p_id uuid, p_template jsonb, p_exercises jsonb)
returns public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- Users can't set a program (that's for ready-made templates).
  return public.write_template(p_id, uid, p_template - 'program' - 'position', p_exercises);
end;
$$;

revoke execute on function public.save_template(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_template(uuid, jsonb, jsonb) to authenticated;

-- Copies a finished workout into a new template of the user's: same
-- exercises in order, number of working sets, and the rep range done.
create or replace function public.template_from_workout(p_workout_id uuid, p_name text)
returns public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  exercises jsonb;
begin
  if not exists (select 1 from public.workouts where id = p_workout_id and user_id = uid) then
    raise exception 'workout % not found', p_workout_id using errcode = 'P0002';
  end if;

  select jsonb_agg(jsonb_build_object(
           'exercise_id', b.exercise_id,
           'target_sets', least(greatest(b.sets, 1), 20),
           'target_reps_min', b.reps_min,
           'target_reps_max', case when b.reps_max > b.reps_min then b.reps_max end,
           'target_duration_seconds', b.duration
         ) order by b.exercise_order)
  into exercises
  from (
    select s.exercise_order, s.exercise_id,
           count(*) filter (where s.set_type <> 'warmup') as sets,
           least(min(s.reps) filter (where s.set_type <> 'warmup' and s.reps > 0), 100) as reps_min,
           least(max(s.reps) filter (where s.set_type <> 'warmup' and s.reps > 0), 100) as reps_max,
           max(s.duration_seconds) as duration
    from public.workout_sets s
    where s.workout_id = p_workout_id
    group by s.exercise_order, s.exercise_id
  ) b;

  return public.write_template(null, uid, jsonb_build_object('name', p_name), exercises);
end;
$$;

revoke execute on function public.template_from_workout(uuid, text) from public, anon;
grant execute on function public.template_from_workout(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: ready-made templates. Every call is logged; non-admins are rejected
-- (log_admin_action raises, rolling back the change).
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_template(p_id uuid, p_template jsonb, p_exercises jsonb)
returns public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.templates;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  result := public.write_template(p_id, null, p_template, p_exercises);
  perform public.log_admin_action(
    case when p_id is null then 'template.create' else 'template.update' end,
    'template', result.id::text,
    jsonb_build_object('name', result.name, 'program', result.program,
                       'exercises', jsonb_array_length(p_exercises))
  );
  return result;
end;
$$;

create or replace function public.admin_set_template_hidden(p_id uuid, p_hidden boolean)
returns public.templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.templates;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.templates set is_hidden = p_hidden
  where id = p_id and owner_id is null
  returning * into result;
  if result.id is null then
    raise exception 'ready-made template % not found', p_id using errcode = 'P0002';
  end if;
  perform public.log_admin_action(
    case when p_hidden then 'template.hide' else 'template.unhide' end,
    'template', p_id::text, jsonb_build_object('name', result.name)
  );
  return result;
end;
$$;

create or replace function public.admin_delete_template(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed public.templates;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.templates where id = p_id and owner_id is null returning * into removed;
  if removed.id is null then
    raise exception 'ready-made template % not found', p_id using errcode = 'P0002';
  end if;
  perform public.log_admin_action('template.delete', 'template', p_id::text,
                                  jsonb_build_object('name', removed.name, 'program', removed.program));
end;
$$;

revoke execute on function public.admin_save_template(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_template(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.admin_set_template_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_template_hidden(uuid, boolean) to authenticated;
revoke execute on function public.admin_delete_template(uuid) from public, anon;
grant execute on function public.admin_delete_template(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_workout v2: security definer (clients can't write workouts directly
-- any more), checks ownership explicitly, records template_id, and calls
-- after_workout_change. Used both when finishing and when editing a past
-- workout; duration and volume are always recomputed here.
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
  result public.workouts;
  bad_exercise uuid;
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

  -- Only keep a template link the user can actually see.
  if tid is not null and not exists (
    select 1 from public.templates t where t.id = tid and (t.owner_id is null or t.owner_id = uid)
  ) then
    tid := null;
  end if;

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

  perform public.after_workout_change(uid, result.id);
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
begin
  delete from public.workouts where id = p_id and user_id = uid;
  if not found then
    raise exception 'workout % not found', p_id using errcode = 'P0002';
  end if;
  perform public.after_workout_change(uid, p_id);
end;
$$;

revoke execute on function public.delete_workout(uuid) from public, anon;
grant execute on function public.delete_workout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: ready-made templates.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.seed_template(
  p_program text, p_position int, p_name text, p_notes text, p_items jsonb
) returns void language plpgsql as $$
declare
  tid uuid;
begin
  insert into public.templates (owner_id, name, notes, program, position)
  values (null, p_name, p_notes, p_program, p_position)
  returning id into tid;

  insert into public.template_exercises (template_id, exercise_id, position, target_sets, target_reps_min, target_reps_max, target_duration_seconds)
  select tid, x.id, (i.ord - 1)::smallint, (i.item ->> 1)::smallint,
         nullif(i.item ->> 2, '')::smallint, nullif(i.item ->> 3, '')::smallint, nullif(i.item ->> 4, '')::integer
  from jsonb_array_elements(p_items) with ordinality as i(item, ord)
  join public.exercises x on x.slug = i.item ->> 0;
end $$;

-- Items: [slug, sets, reps_min, reps_max, duration_seconds]
select pg_temp.seed_template('Push Pull Legs', 1, 'Push', 'Chest, shoulders, triceps.', '[
  ["barbell_bench_press", 4, 6, 8, null], ["overhead_press", 3, 8, 10, null],
  ["incline_dumbbell_press", 3, 8, 12, null], ["lateral_raise", 3, 12, 15, null],
  ["tricep_pushdown", 3, 10, 12, null], ["overhead_tricep_extension", 3, 10, 12, null]]');
select pg_temp.seed_template('Push Pull Legs', 2, 'Pull', 'Back, rear delts, biceps.', '[
  ["deadlift", 3, 5, null, null], ["pull_up", 3, 6, 10, null], ["barbell_row", 3, 8, 10, null],
  ["face_pull", 3, 12, 15, null], ["barbell_curl", 3, 8, 12, null], ["hammer_curl", 3, 10, 12, null]]');
select pg_temp.seed_template('Push Pull Legs', 3, 'Legs', 'Quads, hamstrings, glutes, calves.', '[
  ["back_squat", 4, 6, 8, null], ["romanian_deadlift", 3, 8, 10, null], ["leg_press", 3, 10, 12, null],
  ["lying_leg_curl", 3, 10, 12, null], ["standing_calf_raise", 4, 12, 15, null]]');

select pg_temp.seed_template('Upper / Lower', 1, 'Upper', 'Upper body, heavy compounds first.', '[
  ["barbell_bench_press", 4, 6, 8, null], ["barbell_row", 4, 6, 8, null],
  ["seated_dumbbell_press", 3, 8, 10, null], ["lat_pulldown", 3, 8, 12, null],
  ["dumbbell_curl", 2, 10, 12, null], ["tricep_pushdown", 2, 10, 12, null]]');
select pg_temp.seed_template('Upper / Lower', 2, 'Lower', 'Lower body and core.', '[
  ["back_squat", 4, 6, 8, null], ["romanian_deadlift", 3, 8, 10, null],
  ["bulgarian_split_squat", 3, 8, 10, null], ["seated_leg_curl", 3, 10, 12, null],
  ["standing_calf_raise", 3, 12, 15, null], ["plank", 3, null, null, 45]]');

select pg_temp.seed_template('Full Body', 1, 'Full Body', 'Whole body in one session, 2–3× a week.', '[
  ["back_squat", 3, 6, 8, null], ["barbell_bench_press", 3, 6, 8, null], ["barbell_row", 3, 8, 10, null],
  ["overhead_press", 2, 8, 10, null], ["romanian_deadlift", 2, 8, 10, null], ["plank", 2, null, null, 45]]');

select pg_temp.seed_template('5×5', 1, '5×5 – A', 'Alternate A and B. Add weight each session when all 5×5 are done.', '[
  ["back_squat", 5, 5, null, null], ["barbell_bench_press", 5, 5, null, null], ["barbell_row", 5, 5, null, null]]');
select pg_temp.seed_template('5×5', 2, '5×5 – B', 'Alternate A and B. Deadlift is 1×5.', '[
  ["back_squat", 5, 5, null, null], ["overhead_press", 5, 5, null, null], ["deadlift", 1, 5, null, null]]');
