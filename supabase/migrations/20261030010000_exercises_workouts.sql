-- Stage 2: exercise library, per-exercise rest settings, workouts and sets.

create type public.muscle_group as enum (
  'chest', 'back', 'lower_back', 'traps', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'full_body', 'cardio'
);
create type public.equipment as enum (
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band',
  'smith_machine', 'ez_bar', 'cardio_machine', 'other'
);
create type public.exercise_type as enum ('weights', 'bodyweight', 'cardio', 'timed');
create type public.set_type as enum ('warmup', 'normal', 'drop', 'failure');

-- ---------------------------------------------------------------------------
-- Exercises. owner_id null = global (managed by admins), otherwise a user's
-- custom exercise, visible only to them.
-- ---------------------------------------------------------------------------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  primary_muscle public.muscle_group not null,
  secondary_muscles public.muscle_group[] not null default '{}',
  equipment public.equipment not null,
  type public.exercise_type not null,
  instructions text,
  default_rest_seconds integer not null default 90,
  owner_id uuid references auth.users (id) on delete cascade,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exercises_name_length check (char_length(btrim(name)) between 2 and 60),
  constraint exercises_instructions_length check (char_length(instructions) <= 1000),
  constraint exercises_rest_range check (default_rest_seconds between 0 and 900),
  constraint exercises_slug_global_only check (owner_id is null or slug is null)
);

create unique index exercises_global_name_key on public.exercises (lower(name)) where owner_id is null;
create unique index exercises_custom_name_key on public.exercises (owner_id, lower(name)) where owner_id is not null;
create index exercises_owner_idx on public.exercises (owner_id);

create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();

alter table public.exercises enable row level security;

-- Hidden global exercises stay readable so old workouts still show their
-- names; the app leaves them out of the picker.
create policy "exercises: read global and own"
on public.exercises for select
to authenticated
using (owner_id is null or owner_id = (select auth.uid()));

create policy "exercises: create own custom"
on public.exercises for insert
to authenticated
with check (owner_id = (select auth.uid()) and slug is null);

create policy "exercises: update own custom"
on public.exercises for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()) and slug is null);

create policy "exercises: delete own custom"
on public.exercises for delete
to authenticated
using (owner_id = (select auth.uid()));

-- Global exercises are only written through these admin functions, which
-- check is_admin() and log to admin_actions.
create or replace function public.admin_save_exercise(
  p_id uuid,
  p_name text,
  p_primary_muscle public.muscle_group,
  p_secondary_muscles public.muscle_group[],
  p_equipment public.equipment,
  p_type public.exercise_type,
  p_instructions text,
  p_default_rest_seconds integer
)
returns public.exercises
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.exercises;
begin
  if p_id is null then
    insert into public.exercises (name, primary_muscle, secondary_muscles, equipment, type, instructions, default_rest_seconds)
    values (btrim(p_name), p_primary_muscle, coalesce(p_secondary_muscles, '{}'), p_equipment, p_type,
            nullif(btrim(p_instructions), ''), p_default_rest_seconds)
    returning * into result;
  else
    update public.exercises set
      name = btrim(p_name),
      primary_muscle = p_primary_muscle,
      secondary_muscles = coalesce(p_secondary_muscles, '{}'),
      equipment = p_equipment,
      type = p_type,
      instructions = nullif(btrim(p_instructions), ''),
      default_rest_seconds = p_default_rest_seconds
    where id = p_id and owner_id is null
    returning * into result;
    if result.id is null then
      raise exception 'global exercise % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  -- Raises for non-admins, which rolls back the write above.
  perform public.log_admin_action(
    case when p_id is null then 'exercise.create' else 'exercise.update' end,
    'exercise', result.id::text,
    jsonb_build_object('name', result.name, 'primary_muscle', result.primary_muscle,
                       'equipment', result.equipment, 'type', result.type)
  );
  return result;
end;
$$;

create or replace function public.admin_set_exercise_hidden(p_id uuid, p_hidden boolean)
returns public.exercises
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.exercises;
begin
  update public.exercises set is_hidden = p_hidden
  where id = p_id and owner_id is null
  returning * into result;
  if result.id is null then
    raise exception 'global exercise % not found', p_id using errcode = 'P0002';
  end if;
  -- Raises for non-admins, which rolls back the update above.
  perform public.log_admin_action(
    case when p_hidden then 'exercise.hide' else 'exercise.unhide' end,
    'exercise', p_id::text, jsonb_build_object('name', result.name)
  );
  return result;
end;
$$;

revoke execute on function public.admin_save_exercise(uuid, text, public.muscle_group, public.muscle_group[], public.equipment, public.exercise_type, text, integer) from public, anon;
grant execute on function public.admin_save_exercise(uuid, text, public.muscle_group, public.muscle_group[], public.equipment, public.exercise_type, text, integer) to authenticated;
revoke execute on function public.admin_set_exercise_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_exercise_hidden(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-user rest timer per exercise.
-- ---------------------------------------------------------------------------
create table public.user_exercise_settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  rest_seconds integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id),
  constraint user_exercise_settings_rest_range check (rest_seconds between 0 and 900)
);

create trigger user_exercise_settings_set_updated_at
before update on public.user_exercise_settings
for each row execute function public.set_updated_at();

alter table public.user_exercise_settings enable row level security;

create policy "user_exercise_settings: own"
on public.user_exercise_settings for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Workouts and sets. IDs are generated on the device so a retried save (and
-- offline sync in Stage 5) can't create duplicates.
-- ---------------------------------------------------------------------------
create table public.workouts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null,
  total_volume_kg numeric(10, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workouts_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint workouts_notes_length check (char_length(notes) <= 2000),
  constraint workouts_time_order check (ended_at >= started_at),
  constraint workouts_duration_range check (duration_seconds between 0 and 86400),
  constraint workouts_volume_positive check (total_volume_kg >= 0)
);

create index workouts_user_started_idx on public.workouts (user_id, started_at desc);

create trigger workouts_set_updated_at
before update on public.workouts
for each row execute function public.set_updated_at();

alter table public.workouts enable row level security;

create policy "workouts: own"
on public.workouts for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create table public.workout_sets (
  id uuid primary key,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  exercise_order smallint not null,
  set_order smallint not null,
  set_type public.set_type not null default 'normal',
  weight_kg numeric(6, 2),
  reps smallint,
  rpe numeric(3, 1),
  duration_seconds integer,
  distance_m numeric(9, 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workout_sets_weight_range check (weight_kg between 0 and 1000),
  constraint workout_sets_reps_range check (reps between 0 and 1000),
  constraint workout_sets_rpe_range check (rpe between 1 and 10),
  constraint workout_sets_duration_range check (duration_seconds between 0 and 86400),
  constraint workout_sets_distance_range check (distance_m between 0 and 1000000)
);

create index workout_sets_workout_idx on public.workout_sets (workout_id, exercise_order, set_order);
create index workout_sets_user_exercise_idx on public.workout_sets (user_id, exercise_id);

create trigger workout_sets_set_updated_at
before update on public.workout_sets
for each row execute function public.set_updated_at();

alter table public.workout_sets enable row level security;

create policy "workout_sets: read own"
on public.workout_sets for select
to authenticated
using (user_id = (select auth.uid()));

create policy "workout_sets: write own"
on public.workout_sets for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = (select auth.uid()))
);

create policy "workout_sets: update own"
on public.workout_sets for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = (select auth.uid()))
);

create policy "workout_sets: delete own"
on public.workout_sets for delete
to authenticated
using (user_id = (select auth.uid()));

-- Saves a finished workout and its sets in one transaction. Idempotent on the
-- workout id: saving again replaces the sets. Duration and volume are
-- computed here, not trusted from the app. Runs with the caller's rights, so
-- RLS applies.
create or replace function public.save_workout(p_workout jsonb, p_sets jsonb)
returns public.workouts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result public.workouts;
  started timestamptz := (p_workout ->> 'started_at')::timestamptz;
  ended timestamptz := (p_workout ->> 'ended_at')::timestamptz;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'a workout needs at least one completed set' using errcode = '22023';
  end if;

  insert into public.workouts as w (id, user_id, name, started_at, ended_at, duration_seconds, notes)
  values (
    (p_workout ->> 'id')::uuid, uid, btrim(p_workout ->> 'name'), started, ended,
    floor(extract(epoch from (ended - started)))::integer,
    nullif(btrim(p_workout ->> 'notes'), '')
  )
  on conflict (id) do update set
    name = excluded.name,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    duration_seconds = excluded.duration_seconds,
    notes = excluded.notes
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

  -- Volume = weight x reps over working sets (warm-ups excluded).
  update public.workouts set total_volume_kg = coalesce((
    select round(sum(weight_kg * reps), 2) from public.workout_sets
    where workout_id = result.id and set_type <> 'warmup'
  ), 0)
  where id = result.id
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.save_workout(jsonb, jsonb) from public, anon;
grant execute on function public.save_workout(jsonb, jsonb) to authenticated;

-- For each exercise, the sets from the most recent workout that included it.
create or replace function public.last_exercise_sets(p_exercise_ids uuid[])
returns table (
  exercise_id uuid,
  set_index integer,
  set_type public.set_type,
  weight_kg numeric,
  reps smallint,
  rpe numeric,
  duration_seconds integer,
  distance_m numeric,
  performed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.exercise_id,
         (row_number() over (partition by s.exercise_id order by s.exercise_order, s.set_order))::integer,
         s.set_type, s.weight_kg, s.reps, s.rpe, s.duration_seconds, s.distance_m, w.started_at
  from unnest(p_exercise_ids) as e (id)
  cross join lateral (
    select w2.id
    from public.workout_sets s2
    join public.workouts w2 on w2.id = s2.workout_id
    where s2.exercise_id = e.id and s2.user_id = (select auth.uid())
    order by w2.started_at desc
    limit 1
  ) as last_workout
  join public.workout_sets s on s.workout_id = last_workout.id and s.exercise_id = e.id
  join public.workouts w on w.id = s.workout_id
  order by s.exercise_id, s.exercise_order, s.set_order;
$$;

revoke execute on function public.last_exercise_sets(uuid[]) from public, anon;
grant execute on function public.last_exercise_sets(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: global exercise library.
-- ---------------------------------------------------------------------------
-- 106 global exercises
insert into public.exercises (slug, name, primary_muscle, secondary_muscles, equipment, type, default_rest_seconds, instructions)
values
  ('barbell_bench_press', 'Bench Press (Barbell)', 'chest', array['triceps', 'shoulders']::public.muscle_group[], 'barbell', 'weights', 180, 'Lie on the bench, eyes under the bar. Grip slightly wider than shoulders, lower the bar to mid-chest with elbows about 45°, then press back up. Keep feet planted and shoulder blades pinched.'),
  ('incline_barbell_bench_press', 'Incline Bench Press (Barbell)', 'chest', array['shoulders', 'triceps']::public.muscle_group[], 'barbell', 'weights', 180, 'Set the bench to 30–45°. Lower the bar to the upper chest and press up over the shoulders.'),
  ('decline_bench_press', 'Decline Bench Press (Barbell)', 'chest', array['triceps']::public.muscle_group[], 'barbell', 'weights', 150, 'Lock your legs in on a decline bench. Lower the bar to the lower chest and press up.'),
  ('dumbbell_bench_press', 'Bench Press (Dumbbell)', 'chest', array['triceps', 'shoulders']::public.muscle_group[], 'dumbbell', 'weights', 120, 'Lie flat with a dumbbell in each hand over your chest. Lower until elbows are just below the bench, then press up and slightly together.'),
  ('incline_dumbbell_press', 'Incline Bench Press (Dumbbell)', 'chest', array['shoulders', 'triceps']::public.muscle_group[], 'dumbbell', 'weights', 120, 'On a 30–45° bench, lower the dumbbells to the upper chest and press them up over your shoulders.'),
  ('dumbbell_fly', 'Chest Fly (Dumbbell)', 'chest', array['shoulders']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Lie flat, arms up with a slight bend in the elbows. Open your arms wide until you feel a stretch in the chest, then bring them back together.'),
  ('cable_crossover', 'Cable Crossover', 'chest', array['shoulders']::public.muscle_group[], 'cable', 'weights', 90, 'Stand between two high pulleys. With a slight elbow bend, pull the handles down and together in front of your hips, then return slowly.'),
  ('machine_chest_press', 'Chest Press (Machine)', 'chest', array['triceps', 'shoulders']::public.muscle_group[], 'machine', 'weights', 120, 'Adjust the seat so the handles are at mid-chest. Press forward until arms are almost straight, then return under control.'),
  ('pec_deck', 'Pec Deck (Machine)', 'chest', array['shoulders']::public.muscle_group[], 'machine', 'weights', 90, 'Sit with your back flat against the pad. Bring the handles together in front of your chest, squeeze, then open slowly.'),
  ('push_up', 'Push-up', 'chest', array['triceps', 'shoulders', 'abs']::public.muscle_group[], 'bodyweight', 'bodyweight', 90, 'Hands slightly wider than shoulders, body in a straight line. Lower your chest to just above the floor and push back up.'),
  ('chest_dip', 'Dip (Chest)', 'chest', array['triceps', 'shoulders']::public.muscle_group[], 'bodyweight', 'bodyweight', 120, 'On parallel bars, lean forward slightly and lower until your shoulders are just below your elbows, then press up.'),
  ('deadlift', 'Deadlift (Barbell)', 'back', array['hamstrings', 'glutes', 'lower_back', 'traps', 'forearms']::public.muscle_group[], 'barbell', 'weights', 180, 'Bar over mid-foot, hip-width stance. Hinge down, grip just outside the legs, brace, and stand up by pushing the floor away. Keep the bar close and your back flat.'),
  ('pull_up', 'Pull-up', 'back', array['biceps', 'forearms']::public.muscle_group[], 'bodyweight', 'bodyweight', 150, 'Hang from the bar with an overhand grip, slightly wider than shoulders. Pull until your chin clears the bar, then lower all the way down.'),
  ('chin_up', 'Chin-up', 'back', array['biceps']::public.muscle_group[], 'bodyweight', 'bodyweight', 150, 'Hang with an underhand grip, shoulder-width. Pull your chin over the bar, then lower with control.'),
  ('lat_pulldown', 'Lat Pulldown (Cable)', 'back', array['biceps']::public.muscle_group[], 'cable', 'weights', 120, 'Grip the bar wider than shoulders. Pull it to your upper chest, leading with the elbows, then let it rise slowly.'),
  ('close_grip_lat_pulldown', 'Lat Pulldown – Close Grip (Cable)', 'back', array['biceps']::public.muscle_group[], 'cable', 'weights', 120, 'Use a V-handle. Pull it to your upper chest, keeping your torso still, then return slowly.'),
  ('barbell_row', 'Bent Over Row (Barbell)', 'back', array['biceps', 'lower_back', 'traps']::public.muscle_group[], 'barbell', 'weights', 150, 'Hinge forward to about 45° with a flat back. Pull the bar to your lower ribs, then lower it under control.'),
  ('pendlay_row', 'Pendlay Row (Barbell)', 'back', array['biceps', 'lower_back']::public.muscle_group[], 'barbell', 'weights', 150, 'Torso parallel to the floor. Row the bar from the floor to your chest explosively, then set it back down each rep.'),
  ('dumbbell_row', 'Row (Dumbbell)', 'back', array['biceps']::public.muscle_group[], 'dumbbell', 'weights', 90, 'One knee and hand on a bench. Pull the dumbbell toward your hip, then lower until your arm is straight.'),
  ('seated_cable_row', 'Seated Row (Cable)', 'back', array['biceps', 'traps']::public.muscle_group[], 'cable', 'weights', 120, 'Sit tall with a slight knee bend. Pull the handle to your stomach, squeeze your shoulder blades, then extend your arms.'),
  ('t_bar_row', 'T-Bar Row', 'back', array['biceps', 'traps', 'lower_back']::public.muscle_group[], 'barbell', 'weights', 150, 'Straddle the bar, hinge forward with a flat back, and row the handle to your chest.'),
  ('chest_supported_row', 'Chest Supported Row (Dumbbell)', 'back', array['biceps', 'traps']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Lie face down on an incline bench. Row the dumbbells up toward your hips and lower slowly.'),
  ('straight_arm_pulldown', 'Straight Arm Pulldown (Cable)', 'back', '{}'::public.muscle_group[], 'cable', 'weights', 90, 'Arms almost straight, push the bar from eye level down to your thighs using your lats, then return slowly.'),
  ('inverted_row', 'Inverted Row', 'back', array['biceps']::public.muscle_group[], 'bodyweight', 'bodyweight', 90, 'Hang under a bar set at waist height, body straight. Pull your chest to the bar and lower.'),
  ('rack_pull', 'Rack Pull (Barbell)', 'back', array['traps', 'glutes', 'lower_back']::public.muscle_group[], 'barbell', 'weights', 180, 'Set the bar on pins at knee height. Grip, brace and stand up tall, then lower back to the pins.'),
  ('back_extension', 'Back Extension', 'lower_back', array['glutes', 'hamstrings']::public.muscle_group[], 'bodyweight', 'bodyweight', 90, 'On a hyperextension bench, hinge down at the hips, then raise your torso until it''s in line with your legs.'),
  ('good_morning', 'Good Morning (Barbell)', 'lower_back', array['hamstrings', 'glutes']::public.muscle_group[], 'barbell', 'weights', 120, 'Bar on your upper back, soft knees. Hinge forward with a flat back until you feel your hamstrings stretch, then stand up.'),
  ('barbell_shrug', 'Shrug (Barbell)', 'traps', array['forearms']::public.muscle_group[], 'barbell', 'weights', 90, 'Hold the bar at arm''s length. Lift your shoulders straight up toward your ears, pause, and lower.'),
  ('dumbbell_shrug', 'Shrug (Dumbbell)', 'traps', array['forearms']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Dumbbells at your sides. Shrug your shoulders straight up, pause, and lower slowly.'),
  ('overhead_press', 'Overhead Press (Barbell)', 'shoulders', array['triceps', 'traps']::public.muscle_group[], 'barbell', 'weights', 180, 'Standing, bar at collarbone height. Brace your core and glutes, press the bar overhead, moving your head back slightly, then lower to the start.'),
  ('seated_dumbbell_press', 'Shoulder Press (Dumbbell)', 'shoulders', array['triceps']::public.muscle_group[], 'dumbbell', 'weights', 120, 'Seated with back support, dumbbells at shoulder height. Press up until arms are straight, then lower.'),
  ('arnold_press', 'Arnold Press (Dumbbell)', 'shoulders', array['triceps']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Start with palms facing you at chin height. Rotate your palms forward as you press up, and reverse on the way down.'),
  ('machine_shoulder_press', 'Shoulder Press (Machine)', 'shoulders', array['triceps']::public.muscle_group[], 'machine', 'weights', 120, 'Adjust the seat so the handles are at shoulder height. Press up and lower under control.'),
  ('lateral_raise', 'Lateral Raise (Dumbbell)', 'shoulders', array['traps']::public.muscle_group[], 'dumbbell', 'weights', 60, 'Slight bend in the elbows. Raise the dumbbells out to the sides to shoulder height, then lower slowly.'),
  ('cable_lateral_raise', 'Lateral Raise (Cable)', 'shoulders', '{}'::public.muscle_group[], 'cable', 'weights', 60, 'Stand side-on to a low pulley. Raise the handle out to the side to shoulder height and lower slowly.'),
  ('front_raise', 'Front Raise (Dumbbell)', 'shoulders', '{}'::public.muscle_group[], 'dumbbell', 'weights', 60, 'Raise the dumbbells in front of you to shoulder height with straight arms, then lower.'),
  ('rear_delt_fly', 'Rear Delt Fly (Dumbbell)', 'shoulders', array['back']::public.muscle_group[], 'dumbbell', 'weights', 60, 'Hinge forward with a flat back. Raise the dumbbells out to the sides, squeezing your upper back, then lower.'),
  ('reverse_pec_deck', 'Reverse Fly (Machine)', 'shoulders', array['back']::public.muscle_group[], 'machine', 'weights', 60, 'Face the pec deck pad. Push the handles back and out with straight arms, then return slowly.'),
  ('upright_row', 'Upright Row (Barbell)', 'shoulders', array['traps', 'biceps']::public.muscle_group[], 'barbell', 'weights', 90, 'Hold the bar with a shoulder-width grip. Pull it up along your body to chest height, elbows leading, then lower.'),
  ('face_pull', 'Face Pull (Cable)', 'shoulders', array['back', 'traps']::public.muscle_group[], 'cable', 'weights', 60, 'Rope on a high pulley. Pull it toward your face, hands apart and elbows high, then return slowly.'),
  ('landmine_press', 'Landmine Press', 'shoulders', array['chest', 'triceps']::public.muscle_group[], 'barbell', 'weights', 90, 'Hold the end of a landmine bar at shoulder height. Press it up and forward until your arm is straight.'),
  ('barbell_curl', 'Bicep Curl (Barbell)', 'biceps', array['forearms']::public.muscle_group[], 'barbell', 'weights', 90, 'Stand tall, elbows at your sides. Curl the bar up to your shoulders without swinging, then lower fully.'),
  ('ez_bar_curl', 'Bicep Curl (EZ Bar)', 'biceps', array['forearms']::public.muscle_group[], 'ez_bar', 'weights', 90, 'Grip the angled part of the EZ bar. Curl it up with elbows fixed at your sides, then lower slowly.'),
  ('dumbbell_curl', 'Bicep Curl (Dumbbell)', 'biceps', array['forearms']::public.muscle_group[], 'dumbbell', 'weights', 60, 'Dumbbells at your sides, palms forward. Curl up, squeeze, and lower under control.'),
  ('hammer_curl', 'Hammer Curl (Dumbbell)', 'biceps', array['forearms']::public.muscle_group[], 'dumbbell', 'weights', 60, 'Palms facing each other. Curl the dumbbells up keeping that grip, then lower slowly.'),
  ('incline_dumbbell_curl', 'Incline Curl (Dumbbell)', 'biceps', '{}'::public.muscle_group[], 'dumbbell', 'weights', 60, 'Sit back on a 45–60° bench, arms hanging straight. Curl up without moving your upper arms.'),
  ('preacher_curl', 'Preacher Curl (EZ Bar)', 'biceps', '{}'::public.muscle_group[], 'ez_bar', 'weights', 60, 'Upper arms flat on the preacher pad. Curl the bar up, then lower until your arms are almost straight.'),
  ('cable_curl', 'Bicep Curl (Cable)', 'biceps', array['forearms']::public.muscle_group[], 'cable', 'weights', 60, 'Face a low pulley with a straight bar. Curl it up with elbows at your sides and lower slowly.'),
  ('concentration_curl', 'Concentration Curl (Dumbbell)', 'biceps', '{}'::public.muscle_group[], 'dumbbell', 'weights', 60, 'Seated, elbow braced against your inner thigh. Curl the dumbbell up and lower slowly.'),
  ('close_grip_bench_press', 'Close Grip Bench Press (Barbell)', 'triceps', array['chest', 'shoulders']::public.muscle_group[], 'barbell', 'weights', 150, 'Grip the bar about shoulder-width. Lower to the lower chest with elbows tucked, then press up.'),
  ('skull_crusher', 'Skull Crusher (EZ Bar)', 'triceps', '{}'::public.muscle_group[], 'ez_bar', 'weights', 90, 'Lying on a bench, arms up. Bend only at the elbows to lower the bar toward your forehead, then extend.'),
  ('tricep_pushdown', 'Triceps Pushdown (Cable)', 'triceps', '{}'::public.muscle_group[], 'cable', 'weights', 60, 'Elbows pinned to your sides. Push the bar down until your arms are straight, then let it rise slowly.'),
  ('rope_pushdown', 'Triceps Pushdown – Rope (Cable)', 'triceps', '{}'::public.muscle_group[], 'cable', 'weights', 60, 'Push the rope down and pull the ends apart at the bottom, elbows at your sides.'),
  ('overhead_tricep_extension', 'Overhead Triceps Extension (Dumbbell)', 'triceps', '{}'::public.muscle_group[], 'dumbbell', 'weights', 60, 'Hold one dumbbell overhead with both hands. Lower it behind your head by bending the elbows, then extend.'),
  ('cable_overhead_extension', 'Overhead Triceps Extension (Cable)', 'triceps', '{}'::public.muscle_group[], 'cable', 'weights', 60, 'Face away from the pulley with a rope overhead. Extend your arms forward and up, then return slowly.'),
  ('bench_dip', 'Bench Dip', 'triceps', array['chest', 'shoulders']::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'Hands on a bench behind you, legs out. Lower your hips by bending your elbows to about 90°, then push up.'),
  ('tricep_dip', 'Dip (Triceps)', 'triceps', array['chest', 'shoulders']::public.muscle_group[], 'bodyweight', 'bodyweight', 120, 'On parallel bars, torso upright. Lower until elbows reach about 90°, then press up to lockout.'),
  ('wrist_curl', 'Wrist Curl (Barbell)', 'forearms', '{}'::public.muscle_group[], 'barbell', 'weights', 60, 'Forearms on your thighs, palms up. Curl the bar up using only your wrists, then lower.'),
  ('reverse_curl', 'Reverse Curl (Barbell)', 'forearms', array['biceps']::public.muscle_group[], 'barbell', 'weights', 60, 'Overhand grip. Curl the bar up with elbows at your sides and lower slowly.'),
  ('farmers_walk', 'Farmer''s Walk', 'forearms', array['traps', 'full_body']::public.muscle_group[], 'dumbbell', 'timed', 120, 'Hold heavy dumbbells or kettlebells at your sides. Walk with short, quick steps, standing tall, for the set time.'),
  ('back_squat', 'Squat (Barbell)', 'quads', array['glutes', 'hamstrings', 'lower_back']::public.muscle_group[], 'barbell', 'weights', 180, 'Bar on your upper back, feet shoulder-width. Brace, sit down and back until hips are below knees, then drive up. Knees track over toes.'),
  ('front_squat', 'Front Squat (Barbell)', 'quads', array['glutes', 'abs']::public.muscle_group[], 'barbell', 'weights', 180, 'Bar resting on the front of your shoulders, elbows high. Squat down with an upright torso and stand back up.'),
  ('leg_press', 'Leg Press (Machine)', 'quads', array['glutes', 'hamstrings']::public.muscle_group[], 'machine', 'weights', 150, 'Feet shoulder-width on the platform. Lower until knees are near 90°, then press without locking your knees.'),
  ('hack_squat', 'Hack Squat (Machine)', 'quads', array['glutes']::public.muscle_group[], 'machine', 'weights', 150, 'Shoulders under the pads, feet mid-platform. Lower deep, then press back up.'),
  ('leg_extension', 'Leg Extension (Machine)', 'quads', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'Pad on your lower shins. Straighten your legs, squeeze, then lower slowly.'),
  ('bulgarian_split_squat', 'Bulgarian Split Squat (Dumbbell)', 'quads', array['glutes']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Rear foot on a bench. Lower until your back knee nearly touches the floor, then drive up through the front heel.'),
  ('walking_lunge', 'Walking Lunge (Dumbbell)', 'quads', array['glutes', 'hamstrings']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Step forward and lower until both knees are about 90°. Push off and step through into the next lunge.'),
  ('goblet_squat', 'Goblet Squat', 'quads', array['glutes']::public.muscle_group[], 'kettlebell', 'weights', 90, 'Hold a kettlebell or dumbbell at your chest. Squat down between your knees with an upright torso, then stand.'),
  ('smith_machine_squat', 'Squat (Smith Machine)', 'quads', array['glutes']::public.muscle_group[], 'smith_machine', 'weights', 150, 'Bar on your upper back, feet slightly forward. Squat down and drive back up along the fixed path.'),
  ('step_up', 'Step-up (Dumbbell)', 'quads', array['glutes']::public.muscle_group[], 'dumbbell', 'weights', 90, 'Step onto a box with one foot and drive up until standing. Lower under control and repeat.'),
  ('romanian_deadlift', 'Romanian Deadlift (Barbell)', 'hamstrings', array['glutes', 'lower_back']::public.muscle_group[], 'barbell', 'weights', 150, 'Soft knees, bar against your thighs. Push your hips back and lower the bar along your legs until you feel a hamstring stretch, then stand up.'),
  ('dumbbell_romanian_deadlift', 'Romanian Deadlift (Dumbbell)', 'hamstrings', array['glutes', 'lower_back']::public.muscle_group[], 'dumbbell', 'weights', 120, 'Dumbbells in front of your thighs. Hinge at the hips with a flat back, lower to mid-shin, then stand up.'),
  ('lying_leg_curl', 'Lying Leg Curl (Machine)', 'hamstrings', array['calves']::public.muscle_group[], 'machine', 'weights', 60, 'Lie face down, pad above your heels. Curl your heels toward your glutes and lower slowly.'),
  ('seated_leg_curl', 'Seated Leg Curl (Machine)', 'hamstrings', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'Pad behind your lower legs. Curl down and back as far as you can, then return slowly.'),
  ('nordic_curl', 'Nordic Hamstring Curl', 'hamstrings', '{}'::public.muscle_group[], 'bodyweight', 'bodyweight', 120, 'Kneel with your ankles anchored. Lower your body forward as slowly as possible, catch yourself, and push back up.'),
  ('hip_thrust', 'Hip Thrust (Barbell)', 'glutes', array['hamstrings']::public.muscle_group[], 'barbell', 'weights', 120, 'Upper back on a bench, bar over your hips. Drive your hips up until your body is straight from knees to shoulders, squeeze, and lower.'),
  ('glute_bridge', 'Glute Bridge', 'glutes', array['hamstrings']::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'Lie on your back, knees bent. Push through your heels to lift your hips, squeeze, and lower.'),
  ('cable_kickback', 'Glute Kickback (Cable)', 'glutes', '{}'::public.muscle_group[], 'cable', 'weights', 60, 'Ankle strap on a low pulley. Kick your leg straight back, squeeze your glute, and return slowly.'),
  ('sumo_deadlift', 'Sumo Deadlift (Barbell)', 'glutes', array['quads', 'hamstrings', 'back', 'adductors']::public.muscle_group[], 'barbell', 'weights', 180, 'Wide stance, toes out, grip inside the knees. Push your knees out, brace, and stand up with the bar close.'),
  ('hip_abduction_machine', 'Hip Abduction (Machine)', 'glutes', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'Pads on the outside of your knees. Push your legs apart, pause, and return slowly.'),
  ('hip_adduction_machine', 'Hip Adduction (Machine)', 'adductors', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'Pads on the inside of your knees. Squeeze your legs together, pause, and return slowly.'),
  ('standing_calf_raise', 'Standing Calf Raise (Machine)', 'calves', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'Balls of your feet on the edge. Lower your heels for a full stretch, then rise as high as you can.'),
  ('seated_calf_raise', 'Seated Calf Raise (Machine)', 'calves', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'Knees under the pad. Lower your heels, then push up onto your toes and squeeze.'),
  ('leg_press_calf_raise', 'Calf Press (Leg Press)', 'calves', '{}'::public.muscle_group[], 'machine', 'weights', 60, 'On the leg press with legs almost straight, push the platform with the balls of your feet and lower slowly.'),
  ('plank', 'Plank', 'abs', array['obliques', 'shoulders']::public.muscle_group[], 'bodyweight', 'timed', 60, 'Forearms on the floor, body in a straight line from head to heels. Brace your core and hold.'),
  ('side_plank', 'Side Plank', 'obliques', array['abs']::public.muscle_group[], 'bodyweight', 'timed', 60, 'On one forearm, feet stacked. Lift your hips so your body is straight and hold. Switch sides.'),
  ('crunch', 'Crunch', 'abs', '{}'::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'On your back, knees bent. Curl your shoulders off the floor toward your hips, then lower.'),
  ('hanging_leg_raise', 'Hanging Leg Raise', 'abs', array['obliques', 'forearms']::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'Hang from a bar. Raise your legs to hip height or higher without swinging, then lower slowly.'),
  ('cable_crunch', 'Cable Crunch', 'abs', '{}'::public.muscle_group[], 'cable', 'weights', 60, 'Kneel facing a high pulley, rope by your head. Crunch down, bringing elbows toward your knees.'),
  ('ab_wheel_rollout', 'Ab Wheel Rollout', 'abs', array['shoulders', 'lower_back']::public.muscle_group[], 'other', 'bodyweight', 60, 'Kneel holding the wheel. Roll forward as far as you can with a flat back, then pull back with your abs.'),
  ('russian_twist', 'Russian Twist', 'obliques', array['abs']::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'Sit leaning back, feet off the floor. Rotate your torso side to side, touching the floor beside your hips.'),
  ('dead_bug', 'Dead Bug', 'abs', '{}'::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'On your back, arms up and knees over hips. Lower the opposite arm and leg toward the floor, keeping your lower back down, then switch.'),
  ('cable_woodchop', 'Woodchop (Cable)', 'obliques', array['abs', 'shoulders']::public.muscle_group[], 'cable', 'weights', 60, 'Pull the handle diagonally across your body from high to low, rotating through your torso.'),
  ('kettlebell_swing', 'Kettlebell Swing', 'full_body', array['glutes', 'hamstrings', 'lower_back']::public.muscle_group[], 'kettlebell', 'weights', 90, 'Hinge and hike the kettlebell back between your legs, then snap your hips forward to swing it to chest height.'),
  ('power_clean', 'Power Clean (Barbell)', 'full_body', array['traps', 'quads', 'glutes']::public.muscle_group[], 'barbell', 'weights', 180, 'From the floor, pull the bar explosively, shrug, and catch it on the front of your shoulders in a quarter squat.'),
  ('thruster', 'Thruster (Barbell)', 'full_body', array['quads', 'shoulders']::public.muscle_group[], 'barbell', 'weights', 120, 'Front squat down, then drive up and use the momentum to press the bar overhead in one movement.'),
  ('burpee', 'Burpee', 'full_body', array['chest', 'quads']::public.muscle_group[], 'bodyweight', 'bodyweight', 60, 'Drop to a push-up, jump your feet back to your hands, and jump up with arms overhead.'),
  ('mountain_climber', 'Mountain Climber', 'abs', array['shoulders', 'quads']::public.muscle_group[], 'bodyweight', 'timed', 60, 'In a push-up position, drive your knees toward your chest one at a time, quickly, for the set time.'),
  ('treadmill_run', 'Running (Treadmill)', 'cardio', '{}'::public.muscle_group[], 'cardio_machine', 'cardio', 0, 'Log duration and distance. Use a slight incline (1%) to match outdoor running.'),
  ('outdoor_run', 'Running (Outdoor)', 'cardio', '{}'::public.muscle_group[], 'other', 'cardio', 0, 'Log duration and distance.'),
  ('walking', 'Walking', 'cardio', '{}'::public.muscle_group[], 'other', 'cardio', 0, 'Log duration and distance.'),
  ('stationary_bike', 'Cycling (Stationary Bike)', 'cardio', array['quads']::public.muscle_group[], 'cardio_machine', 'cardio', 0, 'Set the seat so your knee is slightly bent at the bottom. Log duration and distance.'),
  ('rowing_machine', 'Rowing (Machine)', 'cardio', array['back', 'quads']::public.muscle_group[], 'cardio_machine', 'cardio', 0, 'Push with your legs first, then lean back and pull the handle to your ribs. Log duration and distance.'),
  ('elliptical', 'Elliptical', 'cardio', '{}'::public.muscle_group[], 'cardio_machine', 'cardio', 0, 'Log duration and distance.'),
  ('stair_climber', 'Stair Climber', 'cardio', array['glutes', 'calves']::public.muscle_group[], 'cardio_machine', 'cardio', 0, 'Stand tall without leaning on the rails. Log duration.'),
  ('jump_rope', 'Jump Rope', 'cardio', array['calves']::public.muscle_group[], 'other', 'timed', 60, 'Small, quick jumps on the balls of your feet. Turn the rope with your wrists.')
on conflict do nothing;
