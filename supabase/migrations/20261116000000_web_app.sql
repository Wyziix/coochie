-- Stage 11 (web-only app): web push, rest timer push, weekly report in the
-- inbox, default rest time, data export and account deletion.
-- idempotent: safe to run again if a previous run stopped halfway.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists default_rest_seconds integer;
alter table public.profiles drop constraint if exists profiles_default_rest;
alter table public.profiles add constraint profiles_default_rest check (default_rest_seconds between 0 and 900);

alter table public.notification_settings add column if not exists weekly_report boolean not null default true;
alter table public.notification_settings add column if not exists rest_timer boolean not null default true;
alter table public.notifications drop constraint if exists notifications_type;
alter table public.notifications add constraint notifications_type check (type in ('friend_request', 'friend_accepted',
  'pr_beaten', 'challenge_invite', 'challenge_ending', 'streak_risk', 'weekly_report'));

-- ---------------------------------------------------------------------------
-- Web push: one subscription per browser/installed app. A device that signs
-- in to another account moves to it.
-- ---------------------------------------------------------------------------
create table if not exists public.web_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint web_push_endpoint check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  constraint web_push_keys check (char_length(p256dh) between 60 and 120 and char_length(auth) between 16 and 40)
);
create index if not exists web_push_user_idx on public.web_push_subscriptions (user_id);

-- Pushes at a set time (the rest timer while the app is in the background).
create table if not exists public.scheduled_pushes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tag text not null,
  send_at timestamptz not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint scheduled_pushes_once unique (user_id, tag),
  constraint scheduled_pushes_text check (char_length(title) <= 80 and char_length(body) <= 200 and char_length(tag) <= 60)
);
create index if not exists scheduled_pushes_due_idx on public.scheduled_pushes (send_at) where sent_at is null;

do $$
declare
  t text;
begin
  foreach t in array array['web_push_subscriptions', 'scheduled_pushes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.web_push_subscriptions to authenticated;
drop policy if exists "web_push_subscriptions: own" on public.web_push_subscriptions;
create policy "web_push_subscriptions: own" on public.web_push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.save_web_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.web_push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, uid, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, last_seen_at = now();
end $$;

create or replace function public.delete_web_push(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.web_push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid()) $$;

-- Rest timer: replaces the one with the same tag; only if this user has
-- push on a device and didn't turn rest timer pushes off.
create or replace function public.schedule_push(p_tag text, p_seconds integer, p_title text, p_body text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_seconds not between 5 and 1800 then raise exception 'between 5 and 1800 seconds' using errcode = '22023'; end if;
  if not exists (select 1 from public.web_push_subscriptions where user_id = uid)
     or not coalesce((select rest_timer from public.notification_settings where user_id = uid), true) then
    return false;
  end if;
  insert into public.scheduled_pushes (user_id, tag, send_at, title, body, data)
  values (uid, p_tag, now() + make_interval(secs => p_seconds), left(p_title, 80), left(p_body, 200),
          jsonb_build_object('url', '/workouts/active', 'tag', p_tag))
  on conflict (user_id, tag) do update set send_at = excluded.send_at, title = excluded.title, body = excluded.body,
    sent_at = null, created_at = now();
  return true;
end $$;

create or replace function public.cancel_push(p_tag text)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.scheduled_pushes where user_id = (select auth.uid()) and tag = p_tag and sent_at is null $$;

-- The weekly report function puts its notice in the inbox (and push).
create or replace function public.ai_notify_weekly_report(p_user uuid, p_report uuid, p_summary text)
returns void
language sql
security definer
set search_path = ''
as $$
  select public._notify(p_user, 'weekly_report', p_report::text, 'Your weekly report is ready',
    case when char_length(p_summary) > 110 then left(p_summary, 107) || '…' else p_summary end,
    jsonb_build_object('url', '/reports/' || p_report))
$$;

-- ---------------------------------------------------------------------------
-- Push delivery: inbox entries (last hour) and due scheduled pushes, for users
-- with a web push subscription. The send-push function claims a run once.
-- ---------------------------------------------------------------------------
create or replace function public.push_claim(p_run uuid, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  msgs jsonb;
begin
  update public.push_runs set claimed_at = now()
  where id = p_run and token_hash = extensions.digest(coalesce(p_token, ''), 'sha256')
    and claimed_at is null and created_at > now() - interval '10 minutes';
  if not found then raise exception 'invalid or used run' using errcode = '42501'; end if;
  with inbox as (
    update public.notifications n set push_sent_at = now()
    where n.id in (
      select x.id from public.notifications x
      where x.push_sent_at is null and x.created_at > now() - interval '1 hour'
        and exists (select 1 from public.web_push_subscriptions s where s.user_id = x.user_id)
      order by x.created_at limit 500 for update skip locked
    )
    returning n.id, n.user_id, n.title, n.body, n.data, n.type || ':' || n.ref as tag
  ),
  timed as (
    update public.scheduled_pushes p set sent_at = now()
    where p.id in (
      select x.id from public.scheduled_pushes x
      where x.sent_at is null and x.send_at <= now() + interval '3 seconds' and x.created_at > now() - interval '1 hour'
      for update skip locked
    )
    returning null::bigint as id, p.user_id, p.title, p.body, p.data, p.tag
  ),
  all_msgs as (select * from inbox union all select * from timed)
  select coalesce(jsonb_agg(jsonb_build_object(
      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
      'title', m.title, 'body', m.body, 'tag', m.tag,
      'data', m.data || case when m.id is null then '{}'::jsonb else jsonb_build_object('notification_id', m.id) end)), '[]'::jsonb)
  into msgs
  from all_msgs m join public.web_push_subscriptions s on s.user_id = m.user_id;
  update public.push_runs set sent = jsonb_array_length(msgs) where id = p_run;
  -- Old rest-timer rows aren't needed.
  delete from public.scheduled_pushes where created_at < now() - interval '1 day';
  return msgs;
end $$;

-- Subscriptions the push service said are gone (expired or unsubscribed).
create or replace function public.push_forget(p_endpoints text[])
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.web_push_subscriptions where endpoint = any(p_endpoints) $$;

-- Starts a delivery run only when something is due (runs every 10 seconds).
create or replace function public.push_due()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A run that wasn't claimed yet (function starting) is given 30 seconds.
  if exists (select 1 from public.push_runs where claimed_at is null and created_at > now() - interval '30 seconds') then
    return false;
  end if;
  if exists (select 1 from public.scheduled_pushes where sent_at is null and send_at <= now() + interval '3 seconds'
               and created_at > now() - interval '1 hour')
     or exists (select 1 from public.notifications n where n.push_sent_at is null and n.created_at > now() - interval '1 hour'
                  and exists (select 1 from public.web_push_subscriptions s where s.user_id = n.user_id)) then
    perform public.push_start_run();
    return true;
  end if;
  return false;
end $$;
-- Every 5 minutes, as before, but push now goes through push_due().
create or replace function public.social_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text := (select timezone from public.points_settings where id = 1);
  local timestamp := now() at time zone tz;
  finalized integer := public._finalize_challenges();
  c public.challenges;
  p record;
  week date := public._points_week_start(public._points_day(now()));
  st jsonb;
begin
  for c in select * from public.challenges
           where finalized_at is null and not is_hidden
             and ((end_date + 1)::timestamp at time zone tz) between now() and now() + interval '24 hours' loop
    for p in select user_id from public.challenge_participants where challenge_id = c.id and status = 'joined' loop
      perform public._notify(p.user_id, 'challenge_ending', c.id::text, 'Challenge ends in 24 hours',
        '“' || c.title || '” ends at midnight. One more session?', jsonb_build_object('url', '/challenges/' || c.id));
    end loop;
  end loop;
  if extract(isodow from local) = 7 and extract(hour from local) >= 18 then
    for p in select distinct l.user_id from public.points_ledger l
             where l.reason = 'weekly_goal' and l.source_id = (week - 7)::text loop
      st := public._streak(p.user_id);
      if not (st ->> 'this_week_done')::boolean then
        perform public._notify(p.user_id, 'streak_risk', week::text, 'Your streak is at risk',
          format('%s week streak: %s of %s sessions this week. The week ends at midnight.',
                 st ->> 'current', st ->> 'this_week_sessions', st ->> 'goal'),
          jsonb_build_object('url', '/'));
      end if;
    end loop;
  end if;
  perform public.push_due();
  return jsonb_build_object('finalized', finalized);
end $$;

-- ---------------------------------------------------------------------------
-- Export: everything the user has, as one JSON document. The export-data
-- Edge Function turns it into CSVs + data.json. Limited to 5 an hour / 10 a day.
-- ---------------------------------------------------------------------------
create or replace function public.export_user_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  out jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  perform public._rate_limit(p_user, 'export', 5, 10);
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'units', p.units,
        'goal', p.goal, 'experience_level', p.experience_level, 'training_days_per_week', p.training_days_per_week,
        'bodyweight_kg', p.bodyweight_kg, 'height_cm', p.height_cm, 'default_rest_seconds', p.default_rest_seconds,
        'leaderboard_hidden', p.leaderboard_hidden, 'created_at', p.created_at)
      from public.profiles p where p.id = p_user),
    'workouts', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'started_at', w.started_at,
        'ended_at', w.ended_at, 'duration_seconds', w.duration_seconds, 'total_volume_kg', w.total_volume_kg,
        'notes', w.notes, 'template_id', w.template_id) order by w.started_at)
      from public.workouts w where w.user_id = p_user), '[]'::jsonb),
    'sets', coalesce((select jsonb_agg(jsonb_build_object('workout_id', s.workout_id, 'workout_started_at', w.started_at,
        'exercise', e.name, 'exercise_order', s.exercise_order, 'set_order', s.set_order, 'set_type', s.set_type,
        'weight_kg', s.weight_kg, 'reps', s.reps, 'rpe', s.rpe, 'duration_seconds', s.duration_seconds,
        'distance_m', s.distance_m) order by w.started_at, s.exercise_order, s.set_order)
      from public.workout_sets s join public.workouts w on w.id = s.workout_id
      join public.exercises e on e.id = s.exercise_id where s.user_id = p_user), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'notes', t.notes,
        'program', t.program, 'exercises', coalesce((select jsonb_agg(jsonb_build_object('exercise', e.name,
            'position', te.position, 'target_sets', te.target_sets, 'target_reps_min', te.target_reps_min,
            'target_reps_max', te.target_reps_max, 'target_duration_seconds', te.target_duration_seconds,
            'rest_seconds', te.rest_seconds) order by te.position)
          from public.template_exercises te join public.exercises e on e.id = te.exercise_id
          where te.template_id = t.id), '[]'::jsonb)) order by t.position, t.name)
      from public.templates t where t.owner_id = p_user), '[]'::jsonb),
    'personal_records', coalesce((select jsonb_agg(jsonb_build_object('exercise', e.name, 'record_type', r.record_type,
        'value', r.value, 'weight_kg', r.weight_kg, 'reps', r.reps, 'achieved_at', r.achieved_at,
        'previous_value', r.previous_value) order by r.achieved_at)
      from public.personal_records r join public.exercises e on e.id = r.exercise_id where r.user_id = p_user), '[]'::jsonb),
    'body_stats', coalesce((select jsonb_agg(jsonb_build_object('measured_on', b.measured_on,
        'bodyweight_kg', b.bodyweight_kg, 'body_fat_pct', b.body_fat_pct, 'neck_cm', b.neck_cm,
        'shoulders_cm', b.shoulders_cm, 'chest_cm', b.chest_cm, 'waist_cm', b.waist_cm, 'hips_cm', b.hips_cm,
        'arm_cm', b.arm_cm, 'thigh_cm', b.thigh_cm, 'calf_cm', b.calf_cm, 'notes', b.notes) order by b.measured_on)
      from public.body_measurements b where b.user_id = p_user), '[]'::jsonb),
    'food_logs', coalesce((select jsonb_agg(jsonb_build_object('day', f.day, 'meal', f.meal, 'name', f.name,
        'grams', f.grams, 'servings', f.servings, 'kcal', f.kcal, 'protein_g', f.protein, 'carbs_g', f.carbs,
        'fat_g', f.fat) order by f.day, f.created_at)
      from public.food_logs f where f.user_id = p_user), '[]'::jsonb),
    'water', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'ml', x.ml, 'logged_at', x.created_at)
        order by x.created_at) from public.water_logs x where x.user_id = p_user), '[]'::jsonb),
    'nutrition_targets', (select jsonb_build_object('kcal', n.kcal, 'protein_g', n.protein_g, 'carbs_g', n.carbs_g,
        'fat_g', n.fat_g, 'water_ml', n.water_ml, 'method', n.method) from public.nutrition_targets n where n.user_id = p_user),
    'my_foods', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'brand', f.brand, 'barcode', f.barcode,
        'kcal_100g', f.kcal_100g, 'protein_100g', f.protein_100g, 'carbs_100g', f.carbs_100g, 'fat_100g', f.fat_100g,
        'serving_g', f.serving_g, 'serving_label', f.serving_label) order by f.name)
      from public.foods f where f.owner_id = p_user), '[]'::jsonb),
    'favourite_foods', coalesce((select jsonb_agg(f.name order by f.name)
      from public.food_favorites ff join public.foods f on f.id = ff.food_id where ff.user_id = p_user), '[]'::jsonb),
    'points', coalesce((select jsonb_agg(jsonb_build_object('earned_at', l.earned_at, 'day', l.day, 'points', l.points,
        'reason', l.reason, 'source', l.source_type, 'workout_id', l.workout_id) order by l.earned_at, l.id)
      from public.points_ledger l where l.user_id = p_user), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', b.name, 'description', b.description,
        'earned_at', ub.earned_at) order by ub.earned_at)
      from public.user_badges ub join public.badges b on b.id = ub.badge_id where ub.user_id = p_user), '[]'::jsonb),
    'custom_exercises', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'primary_muscle', e.primary_muscle,
        'equipment', e.equipment, 'type', e.type, 'instructions', e.instructions) order by e.name)
      from public.exercises e where e.owner_id = p_user), '[]'::jsonb),
    'programs', coalesce((select jsonb_agg(jsonb_build_object('name', g.name, 'description', g.description,
        'weeks', g.weeks, 'notes', g.notes, 'created_at', g.created_at) order by g.created_at)
      from public.user_programs g where g.user_id = p_user), '[]'::jsonb),
    'coach_messages', coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content,
        'created_at', m.created_at) order by m.created_at) from public.coach_messages m where m.user_id = p_user), '[]'::jsonb),
    'ai_feedback', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'workout_id', a.workout_id,
        'week_start', a.week_start, 'content', a.content, 'created_at', a.created_at) order by a.created_at)
      from public.ai_feedback a where a.user_id = p_user), '[]'::jsonb),
    'friends', coalesce((select jsonb_agg(jsonb_build_object('username', public._username(
          case when f.user_a = p_user then f.user_b else f.user_a end), 'since', f.accepted_at) order by f.accepted_at)
      from public.friendships f where (f.user_a = p_user or f.user_b = p_user) and f.status = 'accepted'), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'metric', c.metric,
        'start_date', c.start_date, 'end_date', c.end_date, 'status', cp.status, 'final_score', cp.final_score,
        'final_rank', cp.final_rank) order by c.start_date)
      from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
      where cp.user_id = p_user), '[]'::jsonb),
    'progress_photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'taken_on', ph.taken_on,
        'pose', ph.pose, 'notes', ph.notes, 'storage_path', ph.storage_path) order by ph.taken_on)
      from public.progress_photos ph where ph.user_id = p_user), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- Replaces the user's id and username (as a whole word, also inside notes)
-- in the values of a JSON document; keys stay.
create or replace function public._anonymise(p_value jsonb, p_id text, p_username text, p_label text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := jsonb_typeof(p_value);
  s text;
begin
  if t = 'object' then
    return coalesce((select jsonb_object_agg(e.key, public._anonymise(e.value, p_id, p_username, p_label))
                     from jsonb_each(p_value) e), '{}'::jsonb);
  elsif t = 'array' then
    return coalesce((select jsonb_agg(public._anonymise(x, p_id, p_username, p_label) order by i)
                     from jsonb_array_elements(p_value) with ordinality as a(x, i)), '[]'::jsonb);
  elsif t = 'string' then
    s := replace(p_value #>> '{}', p_id, p_label);
    if p_username is not null then s := regexp_replace(s, '\m' || p_username || '\M', p_label, 'g'); end if;
    return to_jsonb(s);
  end if;
  return p_value;
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion. The delete-account Edge Function removes the user's
-- storage files first, calls this, then deletes the auth user. Removes every
-- row that belongs to or names the user; admin log entries stay with the user
-- replaced by an anonymous label. The last admin can't be deleted.
-- ---------------------------------------------------------------------------
create or replace function public.delete_user_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text := (select username from public.profiles where id = p_user);
  label text := 'deleted-user-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);
  uid_text text := p_user::text;
  workout_ids text[];
  r record;
  removed bigint := 0;
  n bigint;
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  -- Serialise deletions so two admins can't delete each other at once.
  perform pg_advisory_xact_lock(hashtext('delete_user_data'));
  if (select role from public.profiles where id = p_user) = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'You are the last admin. Make someone else an admin first.' using errcode = '42501', hint = 'last_admin';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id in ('avatars', 'progress-photos')
             and (storage.foldername(o.name))[1] = uid_text) then
    raise exception 'storage files left' using errcode = '55000';
  end if;
  select coalesce(array_agg(id::text), '{}') into workout_ids from public.workouts where user_id = p_user;

  -- Other people's inbox entries about this user (friend requests, PRs, invites).
  delete from public.notifications x
  where x.user_id <> p_user
    and (x.ref = uid_text or split_part(x.ref, ':', 1) = any(workout_ids)
         or (uname is not null and (x.data ->> 'url' = '/users/' || uname
             or starts_with(x.title, uname || ' ') or starts_with(x.body, uname || ' '))));
  -- Reports by or about them, and friend challenges they made (with
  -- everyone's entries).
  delete from public.user_reports where reporter = p_user or reported_user = p_user;
  delete from public.challenges c where (c.kind = 'friend' and c.created_by = p_user)
    or c.exercise_id in (select id from public.exercises where owner_id = p_user);

  -- Admin log: keep the entries, without the user.
  update public.admin_actions a set
    admin_id = case when a.admin_id = p_user then null else a.admin_id end,
    target_id = case when a.target_id = uid_text then label else a.target_id end,
    details = public._anonymise(a.details, uid_text, uname, label)
              || case when a.admin_id = p_user then jsonb_build_object('admin', label) else '{}'::jsonb end
  where a.admin_id = p_user or a.target_id = uid_text or a.details::text like '%' || uid_text || '%'
     or (uname is not null and a.details::text ~ ('\m' || uname || '\M'));

  -- Order matters where foreign keys restrict: badges and food logs before
  -- the workouts and foods they point at; workouts and templates (with their
  -- sets and exercise lists) before the user's own exercises.
  delete from public.user_badges where user_id = p_user;
  delete from public.food_logs where user_id = p_user;
  delete from public.workouts where user_id = p_user;
  delete from public.templates where owner_id = p_user;

  -- Then every other table that points at the user: rows owned by them go,
  -- references from other people's rows (reviewed_by, invited_by, ...) are cleared.
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, c.confdeltype as action
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and array_length(c.conkey, 1) = 1
      and c.connamespace = 'public'::regnamespace and c.conrelid <> 'public.profiles'::regclass
    order by c.confdeltype = 'c' desc, c.conrelid::regclass::text = 'public.exercises'
  loop
    if r.action = 'c' then
      execute format('delete from %s where %I = $1', r.tbl, r.col) using p_user;
    else
      execute format('update %s set %I = null where %I = $1', r.tbl, r.col, r.col) using p_user;
    end if;
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;
  delete from public.profiles where id = p_user;

  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values (null, 'user.deleted', 'user', label, jsonb_build_object('by', 'self'));
  update public.leaderboard_state set dirty = true where id = 1;
  perform public._refresh_leaderboard();
  return jsonb_build_object('label', label, 'rows', removed);
end $$;

-- For the delete-account check: role and username without a client.
create or replace function public.account_for_delete(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('username', p.username, 'role', p.role,
    'last_admin', p.role = 'admin' and (select count(*) from public.profiles where role = 'admin') <= 1)
  from public.profiles p where p.id = p_user
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.push_claim(uuid, text)', 'public.push_forget(text[])', 'public.push_due()', 'public.social_tick()',
    'public.export_user_data(uuid)', 'public.delete_user_data(uuid)', 'public.account_for_delete(uuid)',
    'public.ai_notify_weekly_report(uuid, uuid, text)', 'public._anonymise(jsonb, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.push_claim(uuid, text)', 'public.push_forget(text[])', 'public.export_user_data(uuid)',
    'public.delete_user_data(uuid)', 'public.account_for_delete(uuid)', 'public.ai_notify_weekly_report(uuid, uuid, text)'
  ] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.save_web_push(text, text, text, text)', 'public.delete_web_push(text)',
    'public.schedule_push(text, integer, text, text)', 'public.cancel_push(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Schedule: due pushes every 10 seconds (pg_cron 1.5+), else every minute.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available: push_due is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  begin
    perform cron.schedule('push-due', '10 seconds', 'select public.push_due()');
  exception when others then
    perform cron.schedule('push-due', '* * * * *', 'select public.push_due()');
  end;
exception when others then
  raise warning 'Could not schedule push_due (%). Enable pg_cron and pg_net and run this file again.', sqlerrm;
end $$;
