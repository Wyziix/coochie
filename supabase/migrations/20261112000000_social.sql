-- Stage 9: friends, blocking, activity feed with reactions, streaks, badges,
-- challenges, reports and notifications.
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- Everything that gives something (badges, challenge results, points) is
-- computed here on the server. Badges and feed items are rebuilt in
-- after_workout_change(), so editing or deleting a workout can remove them.

-- ---------------------------------------------------------------------------
-- Points ledger: challenge rewards are a new kind of row, kept when a user's
-- workout points are rebuilt.
-- ---------------------------------------------------------------------------
alter table public.points_ledger drop constraint if exists points_ledger_reason;
alter table public.points_ledger add constraint points_ledger_reason
  check (reason in ('workout', 'sets', 'pr', 'daily_cap', 'weekly_goal', 'streak', 'challenge'));
alter table public.points_ledger drop constraint if exists points_ledger_source;
alter table public.points_ledger add constraint points_ledger_source
  check (source_type in ('workout', 'week', 'challenge'));

-- Admin "ban": off leaderboards, search, feeds and challenges; no social actions.
alter table public.user_moderation add column if not exists banned boolean not null default false;

-- ---------------------------------------------------------------------------
-- Settings the user controls
-- ---------------------------------------------------------------------------
create table if not exists public.privacy_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  activity_visibility text not null default 'friends',
  pr_show_weight boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint privacy_settings_visibility check (activity_visibility in ('friends', 'nobody'))
);
create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  friend_request boolean not null default true,
  friend_accepted boolean not null default true,
  pr_beaten boolean not null default true,
  challenge_invite boolean not null default true,
  challenge_ending boolean not null default true,
  streak_risk boolean not null default true,
  updated_at timestamptz not null default now()
);
do $$
declare
  t text;
begin
  foreach t in array array['privacy_settings', 'notification_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists "%s: own" on public.%I', t, t);
    execute format('create policy "%s: own" on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Friends and blocks (written only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  requested_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  constraint friendships_order check (user_a < user_b),
  constraint friendships_status check (status in ('pending', 'accepted'))
);
create index if not exists friendships_b_idx on public.friendships (user_b);

create table if not exists public.user_blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint user_blocks_not_self check (blocker <> blocked)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked);

-- Server-side rate limits (friend requests, reports, challenges).
create table if not exists public.social_rate_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists social_rate_log_idx on public.social_rate_log (user_id, action, created_at desc);

-- ---------------------------------------------------------------------------
-- Activity feed and reactions
-- ---------------------------------------------------------------------------
create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  workout_id uuid references public.workouts (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint activity_kind check (kind in ('workout', 'pr', 'badge', 'level_up', 'challenge_win')),
  constraint activity_once unique (user_id, kind, ref)
);
create index if not exists activity_user_time_idx on public.activity (user_id, occurred_at desc);
create index if not exists activity_workout_idx on public.activity (workout_id);

create table if not exists public.activity_reactions (
  activity_id uuid not null references public.activity (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null default '💪',
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id),
  constraint activity_reactions_emoji check (emoji in ('💪', '🔥', '👏', '🏆'))
);

-- ---------------------------------------------------------------------------
-- Badges
-- ---------------------------------------------------------------------------
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  description text not null,
  icon text not null default 'ribbon-outline',
  category text not null default 'milestone',
  rule_type text not null,
  rule jsonb not null default '{}'::jsonb,
  position smallint not null default 100,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint badges_name check (char_length(btrim(name)) between 2 and 40),
  constraint badges_description check (char_length(description) between 2 and 160),
  constraint badges_category check (category in ('milestone', 'consistency', 'strength', 'fun', 'challenge')),
  constraint badges_rule_type check (rule_type in ('workout_count', 'total_sets', 'streak_weeks', 'pr_weight',
    'pr_bodyweight', 'any_pr', 'time_of_day', 'long_workout', 'level', 'challenge_wins', 'manual'))
);

create table if not exists public.user_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge_id uuid not null references public.badges (id) on delete cascade,
  earned_at timestamptz not null,
  workout_id uuid references public.workouts (id) on delete set null,
  source text not null default 'auto',
  primary key (user_id, badge_id),
  constraint user_badges_source check (source in ('auto', 'challenge'))
);

-- ---------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  description text,
  metric text not null,
  exercise_id uuid references public.exercises (id) on delete restrict,
  goal numeric,
  start_date date not null,
  end_date date not null,
  reward_points integer not null default 0,
  reward_badge_id uuid references public.badges (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  is_hidden boolean not null default false,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenges_kind check (kind in ('global', 'friend')),
  constraint challenges_title check (char_length(btrim(title)) between 2 and 60),
  constraint challenges_description check (char_length(description) <= 300),
  constraint challenges_metric check (metric in ('workouts', 'sets', 'points', 'exercise')),
  constraint challenges_exercise check ((metric = 'exercise') = (exercise_id is not null)),
  constraint challenges_dates check (end_date >= start_date and end_date - start_date <= 92),
  constraint challenges_goal check (goal is null or goal > 0),
  constraint challenges_reward check (reward_points between 0 and 1000)
);
create index if not exists challenges_dates_idx on public.challenges (end_date, finalized_at);

create table if not exists public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'joined',
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz,
  final_score numeric,
  final_rank integer,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id),
  constraint challenge_participants_status check (status in ('invited', 'joined', 'declined'))
);
create index if not exists challenge_participants_user_idx on public.challenge_participants (user_id);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references auth.users (id) on delete set null,
  reported_user uuid not null references auth.users (id) on delete cascade,
  activity_id uuid references public.activity (id) on delete set null,
  reason text not null,
  note text,
  status text not null default 'open',
  resolution text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_reports_reason check (reason in ('spam', 'harassment', 'cheating', 'inappropriate', 'other')),
  constraint user_reports_note check (char_length(note) <= 500),
  constraint user_reports_status check (status in ('open', 'dismissed', 'actioned'))
);
create index if not exists user_reports_status_idx on public.user_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications (in-app inbox on every platform; Android also gets a push)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  ref text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type check (type in ('friend_request', 'friend_accepted', 'pr_beaten',
    'challenge_invite', 'challenge_ending', 'streak_risk')),
  constraint notifications_once unique (user_id, type, ref)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_push_idx on public.notifications (created_at) where push_sent_at is null;

create table if not exists public.push_runs (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent integer
);

-- RLS: on for every table. Only a few are readable directly; everything else
-- goes through the functions below.
do $$
declare
  t text;
begin
  foreach t in array array['friendships', 'user_blocks', 'social_rate_log', 'activity', 'activity_reactions',
                           'badges', 'user_badges', 'challenges', 'challenge_participants', 'user_reports',
                           'notifications', 'push_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.badges, public.notifications to authenticated;
drop policy if exists "badges: visible" on public.badges;
create policy "badges: visible" on public.badges for select to authenticated
using (not is_hidden or (select public.is_admin()));
drop policy if exists "notifications: own" on public.notifications;
create policy "notifications: own" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Default badges (skips ones that exist; admins can edit or hide them)
-- ---------------------------------------------------------------------------
insert into public.badges (slug, name, description, icon, category, rule_type, rule, position) values
  ('first_workout', 'First rep', 'Finish your first workout.', 'flag-outline', 'milestone', 'workout_count', '{"count": 1}', 10),
  ('workouts_10', 'Regular', 'Finish 10 workouts.', 'barbell-outline', 'milestone', 'workout_count', '{"count": 10}', 11),
  ('workouts_50', 'Committed', 'Finish 50 workouts.', 'barbell', 'milestone', 'workout_count', '{"count": 50}', 12),
  ('workouts_100', 'Centurion', 'Finish 100 workouts.', 'medal-outline', 'milestone', 'workout_count', '{"count": 100}', 13),
  ('workouts_250', 'Gym rat', 'Finish 250 workouts.', 'medal', 'milestone', 'workout_count', '{"count": 250}', 14),
  ('sets_1000', 'A thousand sets', 'Do 1,000 working sets.', 'layers-outline', 'milestone', 'total_sets', '{"count": 1000}', 15),
  ('streak_4', 'One month strong', 'Hit your weekly goal 4 weeks in a row.', 'flame-outline', 'consistency', 'streak_weeks', '{"weeks": 4}', 20),
  ('streak_8', 'Two months strong', 'Hit your weekly goal 8 weeks in a row.', 'flame', 'consistency', 'streak_weeks', '{"weeks": 8}', 21),
  ('streak_12', 'Quarter year', 'Hit your weekly goal 12 weeks in a row.', 'calendar-outline', 'consistency', 'streak_weeks', '{"weeks": 12}', 22),
  ('streak_26', 'Half a year', 'Hit your weekly goal 26 weeks in a row.', 'calendar', 'consistency', 'streak_weeks', '{"weeks": 26}', 23),
  ('streak_52', 'Full year', 'Hit your weekly goal 52 weeks in a row.', 'trophy', 'consistency', 'streak_weeks', '{"weeks": 52}', 24),
  ('first_pr', 'New best', 'Set your first personal record.', 'trending-up-outline', 'strength', 'any_pr', '{"count": 1}', 30),
  ('pr_25', 'Record breaker', 'Set 25 personal records.', 'trending-up', 'strength', 'any_pr', '{"count": 25}', 31),
  ('bench_bw', 'Bench your bodyweight', 'Bench press your own bodyweight for at least one rep.', 'fitness-outline', 'strength', 'pr_bodyweight', '{"exercise": "barbell_bench_press", "ratio": 1}', 32),
  ('squat_1_5bw', 'Squat 1.5× bodyweight', 'Back squat one and a half times your bodyweight.', 'fitness', 'strength', 'pr_bodyweight', '{"exercise": "back_squat", "ratio": 1.5}', 33),
  ('deadlift_2bw', 'Deadlift 2× bodyweight', 'Deadlift twice your bodyweight.', 'flash-outline', 'strength', 'pr_bodyweight', '{"exercise": "deadlift", "ratio": 2}', 34),
  ('early_bird', 'Early bird', 'Start a workout before 7:00.', 'sunny-outline', 'fun', 'time_of_day', '{"from_hour": 4, "to_hour": 7, "count": 1}', 40),
  ('night_owl', 'Night owl', 'Start a workout at 21:00 or later.', 'moon-outline', 'fun', 'time_of_day', '{"from_hour": 21, "to_hour": 24, "count": 1}', 41),
  ('marathon', 'Marathon session', 'Train for 90 minutes or more in one workout.', 'timer-outline', 'fun', 'long_workout', '{"minutes": 90}', 42),
  ('level_10', 'Double digits', 'Reach level 10.', 'star-outline', 'milestone', 'level', '{"level": 10}', 50),
  ('level_25', 'Halfway there', 'Reach level 25.', 'star-half-outline', 'milestone', 'level', '{"level": 25}', 51),
  ('level_50', 'Lightweight baby!', 'Reach level 50, the top.', 'star', 'milestone', 'level', '{"level": 50}', 52),
  ('challenge_winner', 'Champion', 'Win a challenge.', 'ribbon', 'challenge', 'challenge_wins', '{"count": 1}', 60)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._pair(a uuid, b uuid)
returns uuid[]
language sql
immutable
set search_path = ''
as $$ select case when a < b then array[a, b] else array[b, a] end $$;

create or replace function public._are_friends(a uuid, b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.friendships f
                 where f.user_a = least(a, b) and f.user_b = greatest(a, b) and f.status = 'accepted')
$$;

-- Either one blocked the other.
create or replace function public._blocked(a uuid, b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.user_blocks
                 where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;

-- Has a username and isn't hidden or banned by an admin.
create or replace function public._social_ok(u uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = u and p.username is not null
      and not exists (select 1 from public.user_moderation m where m.user_id = u and (m.hidden or m.banned))
  )
$$;

-- Raises with a friendly message when the user did `action` too often.
create or replace function public._rate_limit(u uuid, action text, per_hour integer, per_day integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.social_rate_log l
      where l.user_id = u and l.action = _rate_limit.action and l.created_at > now() - interval '1 hour') >= per_hour
     or (select count(*) from public.social_rate_log l
         where l.user_id = u and l.action = _rate_limit.action and l.created_at > now() - interval '1 day') >= per_day then
    raise exception 'Too many requests. Try again later.' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  insert into public.social_rate_log (user_id, action) values (u, _rate_limit.action);
end $$;

create or replace function public._my_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return uid;
end $$;

-- For social actions: signed in, has a username, not banned.
create or replace function public._social_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  if (select username from public.profiles where id = uid) is null then
    raise exception 'Pick a username first.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_moderation where user_id = uid and banned) then
    raise exception 'Social features are not available for your account.' using errcode = '42501';
  end if;
  return uid;
end $$;

-- Adds an inbox entry unless the user turned that type off. Once per (type, ref).
create or replace function public._notify(u uuid, p_kind text, p_ref text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  execute format('select coalesce((select %I from public.notification_settings where user_id = $1), true)', p_kind)
    into allowed using u;
  if not allowed then return; end if;
  insert into public.notifications (user_id, type, ref, title, body, data)
  values (u, p_kind, p_ref, p_title, p_body, coalesce(p_data, '{}'::jsonb))
  on conflict (user_id, type, ref) do nothing;
end $$;

create or replace function public._username(u uuid)
returns text
language sql
stable
set search_path = ''
as $$ select username from public.profiles where id = u $$;

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------

-- Partial or exact username. Never returns blocked users (either way),
-- hidden/banned users, or me. Exact matches first.
create or replace function public.search_users(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
  q text := lower(btrim(coalesce(p_query, '')));
begin
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'username', p.username, 'avatar_url', p.avatar_url,
        'level', (public.level_for((select coalesce(sum(points), 0) from public.points_ledger l where l.user_id = p.id)) ->> 'level')::int,
        'relation', public._relation(uid, p.id)
      ) order by (p.username = q) desc, p.username)
    from (
      select * from public.profiles p
      where p.id <> uid and p.username like '%' || replace(replace(q, '%', ''), '_', '\_') || '%'
        and public._social_ok(p.id) and not public._blocked(uid, p.id)
      order by (p.username = q) desc, p.username
      limit 20
    ) p
  ), '[]'::jsonb);
end $$;

-- none / friends / outgoing / incoming / blocked (I blocked them)
create or replace function public._relation(me uuid, other uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from public.user_blocks where blocker = me and blocked = other) then 'blocked'
    when f.status = 'accepted' then 'friends'
    when f.status = 'pending' and f.requested_by = me then 'outgoing'
    when f.status = 'pending' then 'incoming'
    else 'none' end
  from (select 1) x
  left join public.friendships f on f.user_a = least(me, other) and f.user_b = greatest(me, other)
$$;

create or replace function public.send_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
  pair uuid[] := public._pair(uid, p_user);
  existing public.friendships;
begin
  if p_user = uid then raise exception 'That''s you.' using errcode = 'P0001'; end if;
  -- Blocked (either way) or hidden users look like they don't exist.
  if public._blocked(uid, p_user) or not public._social_ok(p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select * into existing from public.friendships where user_a = pair[1] and user_b = pair[2];
  if existing.status = 'accepted' then return 'friends'; end if;
  if existing.status = 'pending' and existing.requested_by = uid then return 'outgoing'; end if;
  if existing.status = 'pending' then
    -- They asked first: this accepts.
    return public.respond_friend_request(p_user, true);
  end if;
  perform public._rate_limit(uid, 'friend_request', 10, 30);
  insert into public.friendships (user_a, user_b, requested_by) values (pair[1], pair[2], uid);
  perform public._notify(p_user, 'friend_request', uid::text, 'New friend request',
    public._username(uid) || ' wants to be friends.', jsonb_build_object('url', '/friends'));
  return 'outgoing';
end $$;

create or replace function public.respond_friend_request(p_user uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
  pair uuid[] := public._pair(uid, p_user);
begin
  if not exists (select 1 from public.friendships where user_a = pair[1] and user_b = pair[2]
                 and status = 'pending' and requested_by = p_user) then
    raise exception 'No request from this user.' using errcode = 'P0002';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now() where user_a = pair[1] and user_b = pair[2];
    perform public._notify(p_user, 'friend_accepted', uid::text, 'Friend request accepted',
      public._username(uid) || ' accepted your friend request.', jsonb_build_object('url', '/users/' || public._username(uid)));
    return 'friends';
  end if;
  delete from public.friendships where user_a = pair[1] and user_b = pair[2];
  return 'none';
end $$;

-- Cancel my request, or remove a friend.
create or replace function public.remove_friend(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
  pair uuid[] := public._pair(uid, p_user);
begin
  delete from public.friendships where user_a = pair[1] and user_b = pair[2];
  delete from public.notifications where user_id = p_user and type = 'friend_request' and ref = uid::text and read_at is null;
  return 'none';
end $$;

create or replace function public.block_user(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
  pair uuid[] := public._pair(uid, p_user);
begin
  if p_user = uid then raise exception 'That''s you.' using errcode = 'P0001'; end if;
  insert into public.user_blocks (blocker, blocked) values (uid, p_user) on conflict do nothing;
  delete from public.friendships where user_a = pair[1] and user_b = pair[2];
  delete from public.activity_reactions r using public.activity a
  where r.activity_id = a.id and ((a.user_id = uid and r.user_id = p_user) or (a.user_id = p_user and r.user_id = uid));
  return 'blocked';
end $$;

create or replace function public.unblock_user(p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  delete from public.user_blocks where blocker = (select auth.uid()) and blocked = p_user;
  select 'none';
$$;

create or replace function public.my_friends()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(public._user_card(o.other) order by public._username(o.other))
      from (select case when user_a = uid then user_b else user_a end as other from public.friendships
            where (user_a = uid or user_b = uid) and status = 'accepted') o
      where public._social_ok(o.other)
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(public._user_card(f.requested_by) order by f.created_at desc)
      from public.friendships f
      where (f.user_a = uid or f.user_b = uid) and f.status = 'pending' and f.requested_by <> uid
        and public._social_ok(f.requested_by)
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(public._user_card(case when f.user_a = uid then f.user_b else f.user_a end) order by f.created_at desc)
      from public.friendships f
      where (f.user_a = uid or f.user_b = uid) and f.status = 'pending' and f.requested_by = uid
    ), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', b.blocked, 'username', public._username(b.blocked)) order by b.created_at desc)
      from public.user_blocks b where b.blocker = uid
    ), '[]'::jsonb)
  );
end $$;

-- What anyone may see about a user: username, avatar, level.
create or replace function public._user_card(u uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.id, 'username', p.username, 'avatar_url', p.avatar_url,
    'level', (public.level_for((select coalesce(sum(points), 0) from public.points_ledger l where l.user_id = p.id)) ->> 'level')::int
  )
  from public.profiles p where p.id = u
$$;

-- ---------------------------------------------------------------------------
-- Streaks: from the points ledger's weekly goals (one source of truth).
-- current = weeks in a row up to this week (or last week, if this week's goal
-- isn't reached yet); longest = best run ever.
-- ---------------------------------------------------------------------------
create or replace function public._streak(u uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with w as (
    select distinct source_id::date as week from public.points_ledger
    where user_id = u and reason = 'weekly_goal'
  ),
  isl as (
    select week, week - (row_number() over (order by week) * 7)::int as island from w
  ),
  runs as (select island, count(*) as len, max(week) as last_week from isl group by island),
  now_week as (select public._points_week_start(public._points_day(now())) as wk),
  goal as (
    select least(s.goal_max_days, greatest(s.goal_min_days,
      coalesce((select training_days_per_week from public.profiles where id = u), s.goal_min_days))) as g
    from public.points_settings s where s.id = 1
  )
  select jsonb_build_object(
    'current', coalesce((select r.len from runs r, now_week n where r.last_week in (n.wk, n.wk - 7)), 0),
    'longest', coalesce((select max(len) from runs), 0),
    'this_week_done', exists (select 1 from w, now_week n where w.week = n.wk),
    'this_week_sessions', (select count(*) from public.points_ledger l, now_week n
                           where l.user_id = u and l.reason = 'workout' and l.day >= n.wk),
    'goal', (select g from goal)
  )
$$;

create or replace function public.my_streak()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select public._streak((select auth.uid())) $$;

-- ---------------------------------------------------------------------------
-- Activity: rebuilt for a workout whenever it changes. Only workouts that
-- count (not flagged). Payloads never hold bodyweight, photos or AI text.
-- ---------------------------------------------------------------------------
create or replace function public._refresh_workout_activity(u uuid, w_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.workouts := (select x from public.workouts x where id = w_id and user_id = u);
  pr record;
  f uuid;
  fresh boolean;
  visible boolean := coalesce((select activity_visibility from public.privacy_settings where user_id = u), 'friends') = 'friends';
begin
  if w.id is null then return; end if;  -- deleted: its rows went with it (on delete cascade)
  delete from public.activity where workout_id = w.id and kind in ('workout', 'pr');
  if not public._workout_counts(w.id) then return; end if;

  insert into public.activity (user_id, kind, ref, workout_id, payload, occurred_at)
  select u, 'workout', w.id::text, w.id, jsonb_build_object(
      'name', w.name, 'minutes', round(w.duration_seconds / 60.0),
      'sets', (select count(*) from public.workout_sets s where s.workout_id = w.id and s.set_type <> 'warmup'),
      'exercises', (select count(distinct exercise_id) from public.workout_sets s where s.workout_id = w.id)),
    w.ended_at;

  fresh := w.ended_at > now() - interval '3 days';
  for pr in
    select x.exercise_id, x.name, x.best, x.prev
    from (
      select ws.exercise_id, e.name, max(ws.weight_kg) as best,
        (select max(p.weight_kg) from public.workout_sets p join public.workouts pw on pw.id = p.workout_id
         where pw.user_id = u and p.exercise_id = ws.exercise_id and p.set_type <> 'warmup'
           and (pw.started_at, pw.id) < (w.started_at, w.id) and public._workout_counts(pw.id)) as prev
      from public.workout_sets ws join public.exercises e on e.id = ws.exercise_id
      where ws.workout_id = w.id and ws.set_type <> 'warmup' and ws.weight_kg > 0
      group by ws.exercise_id, e.name
    ) x
    where x.prev > 0 and x.best > x.prev
  loop
    insert into public.activity (user_id, kind, ref, workout_id, payload, occurred_at)
    values (u, 'pr', w.id || ':' || pr.exercise_id, w.id,
            jsonb_build_object('exercise', pr.name, 'weight_kg', pr.best), w.ended_at);
    -- "Friend beat my PR": friends whose best this lift just passed (recent workouts only).
    if fresh and visible then
      for f in
        select case when fr.user_a = u then fr.user_b else fr.user_a end
        from public.friendships fr where (fr.user_a = u or fr.user_b = u) and fr.status = 'accepted'
      loop
        if exists (
          select 1 from (
            select max(s.weight_kg) as best from public.workout_sets s join public.workouts fw on fw.id = s.workout_id
            where fw.user_id = f and s.exercise_id = pr.exercise_id and s.set_type <> 'warmup' and public._workout_counts(fw.id)
          ) fb
          where fb.best > 0 and fb.best >= pr.prev and fb.best < pr.best
        ) and not public._blocked(u, f) then
          perform public._notify(f, 'pr_beaten', w.id || ':' || pr.exercise_id,
            public._username(u) || ' beat your best', public._username(u) || ' just lifted more than your best on ' || pr.name || '.',
            jsonb_build_object('url', '/users/' || public._username(u)));
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- Level-up item for the current level (older ones stay; above-current ones go).
create or replace function public._refresh_level_activity(u uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lvl jsonb := public.level_for((select coalesce(sum(points), 0) from public.points_ledger where user_id = u));
  n int := (lvl ->> 'level')::int;
  reached timestamptz;
begin
  delete from public.activity where user_id = u and kind = 'level_up' and split_part(ref, ':', 2)::int > n;
  if n < 2 then return; end if;
  select earned_at into reached from (
    select earned_at, sum(points) over (order by earned_at, id) as running from public.points_ledger where user_id = u
  ) x where running >= (lvl ->> 'min_points')::bigint order by earned_at limit 1;
  insert into public.activity (user_id, kind, ref, payload, occurred_at)
  values (u, 'level_up', 'level:' || n, jsonb_build_object('level', n, 'name', lvl ->> 'name'), coalesce(reached, now()))
  on conflict (user_id, kind, ref) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Badges: status of one badge for a user (earned when, and progress).
-- ---------------------------------------------------------------------------
create or replace function public._badge_status(u uuid, b public.badges)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target numeric;
  cur numeric := 0;
  at timestamptz;
  wid uuid;
  ex uuid;
  bw numeric;
  tz text := (select timezone from public.points_settings where id = 1);
begin
  case b.rule_type
  when 'workout_count' then
    target := (b.rule ->> 'count')::numeric;
    select count(*) into cur from public.workouts w where w.user_id = u and public._workout_counts(w.id);
    select x.started_at, x.id into at, wid from (
      select w.id, w.started_at, row_number() over (order by w.started_at, w.id) as n
      from public.workouts w where w.user_id = u and public._workout_counts(w.id)
    ) x where x.n = target;
  when 'total_sets' then
    target := (b.rule ->> 'count')::numeric;
    select x.started_at, x.id into at, wid from (
      select w.id, w.started_at, sum(c.n) over (order by w.started_at, w.id) as running
      from public.workouts w
      cross join lateral (select count(*) as n from public.workout_sets s where s.workout_id = w.id and s.set_type <> 'warmup') c
      where w.user_id = u and public._workout_counts(w.id)
    ) x where x.running >= target order by x.started_at limit 1;
    select count(*) into cur from public.workout_sets s join public.workouts w on w.id = s.workout_id
    where w.user_id = u and s.set_type <> 'warmup' and public._workout_counts(w.id);
  when 'streak_weeks' then
    target := (b.rule ->> 'weeks')::numeric;
    cur := (public._streak(u) ->> 'longest')::numeric;
    select y.earned_at, y.workout_id into at, wid from (
      select x.*, row_number() over (partition by x.island order by x.week) as n
      from (
        select l.earned_at, l.workout_id, l.source_id::date as week,
          l.source_id::date - (row_number() over (order by l.source_id::date) * 7)::int as island
        from public.points_ledger l where l.user_id = u and l.reason = 'weekly_goal'
      ) x
    ) y where y.n >= target order by y.earned_at limit 1;
  when 'pr_weight', 'pr_bodyweight' then
    ex := coalesce((select id from public.exercises where slug = b.rule ->> 'exercise'),
                   nullif(b.rule ->> 'exercise_id', '')::uuid);
    bw := (select bodyweight_kg from public.profiles where id = u);
    if b.rule_type = 'pr_weight' then
      target := (b.rule ->> 'kg')::numeric;
    elsif bw is not null then
      target := round((b.rule ->> 'ratio')::numeric * bw, 1);
    else
      target := null;
    end if;
    select coalesce(max(s.weight_kg), 0) into cur from public.workout_sets s join public.workouts w on w.id = s.workout_id
    where w.user_id = u and s.exercise_id = ex and s.set_type <> 'warmup' and s.reps >= 1 and public._workout_counts(w.id);
    if target is not null then
      select w.started_at, w.id into at, wid from public.workout_sets s join public.workouts w on w.id = s.workout_id
      where w.user_id = u and s.exercise_id = ex and s.set_type <> 'warmup' and s.reps >= 1 and s.weight_kg >= target
        and public._workout_counts(w.id)
      order by w.started_at limit 1;
    end if;
  when 'any_pr' then
    target := (b.rule ->> 'count')::numeric;
    select x.earned_at, x.workout_id into at, wid from (
      select l.earned_at, l.workout_id,
        sum(jsonb_array_length(l.details -> 'exercises')) over (order by l.earned_at, l.id) as running
      from public.points_ledger l where l.user_id = u and l.reason = 'pr'
    ) x where x.running >= target order by x.earned_at limit 1;
    select coalesce(sum(jsonb_array_length(details -> 'exercises')), 0) into cur
    from public.points_ledger where user_id = u and reason = 'pr';
  when 'time_of_day' then
    target := coalesce((b.rule ->> 'count')::numeric, 1);
    select count(*) into cur from public.workouts w
    where w.user_id = u and public._workout_counts(w.id)
      and extract(hour from w.started_at at time zone tz) >= (b.rule ->> 'from_hour')::int
      and extract(hour from w.started_at at time zone tz) < (b.rule ->> 'to_hour')::int;
    select x.started_at, x.id into at, wid from (
      select w.id, w.started_at, row_number() over (order by w.started_at, w.id) as n
      from public.workouts w
      where w.user_id = u and public._workout_counts(w.id)
        and extract(hour from w.started_at at time zone tz) >= (b.rule ->> 'from_hour')::int
        and extract(hour from w.started_at at time zone tz) < (b.rule ->> 'to_hour')::int
    ) x where x.n = target;
  when 'long_workout' then
    target := (b.rule ->> 'minutes')::numeric;
    select coalesce(max(round(w.duration_seconds / 60.0)), 0) into cur from public.workouts w
    where w.user_id = u and public._workout_counts(w.id);
    select w.started_at, w.id into at, wid from public.workouts w
    where w.user_id = u and public._workout_counts(w.id) and w.duration_seconds >= target * 60
    order by w.started_at limit 1;
  when 'level' then
    target := (b.rule ->> 'level')::numeric;
    cur := (public.level_for((select coalesce(sum(points), 0) from public.points_ledger where user_id = u)) ->> 'level')::numeric;
    if cur >= target then
      select x.earned_at, x.workout_id into at, wid from (
        select earned_at, workout_id, sum(points) over (order by earned_at, id) as running
        from public.points_ledger where user_id = u
      ) x
      where x.running >= (select round(s.level_base * power(target - 1, s.level_exponent)) from public.points_settings s where id = 1)
      order by x.earned_at limit 1;
    end if;
  when 'challenge_wins' then
    target := (b.rule ->> 'count')::numeric;
    select count(*) into cur from public.challenge_participants p
    where p.user_id = u and p.final_rank = 1 and p.final_score > 0;
    select x.won_at into at from (
      select ((c.end_date + 1)::timestamp at time zone tz) as won_at, row_number() over (order by c.end_date) as n
      from public.challenge_participants p join public.challenges c on c.id = p.challenge_id
      where p.user_id = u and p.final_rank = 1 and p.final_score > 0
    ) x where x.n = target;
  else
    target := null;
  end case;
  return jsonb_build_object('earned_at', at, 'workout_id', wid, 'current', least(cur, coalesce(target, cur)), 'target', target);
end $$;

-- Awards and removes automatic badges (manual/challenge rewards are kept).
create or replace function public._evaluate_badges(u uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.badges;
  st jsonb;
begin
  for b in select * from public.badges where not is_hidden and rule_type <> 'manual' loop
    st := public._badge_status(u, b);
    if st ->> 'earned_at' is not null then
      insert into public.user_badges (user_id, badge_id, earned_at, workout_id)
      values (u, b.id, (st ->> 'earned_at')::timestamptz, nullif(st ->> 'workout_id', '')::uuid)
      on conflict (user_id, badge_id) do update
        set earned_at = excluded.earned_at, workout_id = excluded.workout_id
        where public.user_badges.source = 'auto';
      insert into public.activity (user_id, kind, ref, payload, occurred_at)
      values (u, 'badge', b.id::text, jsonb_build_object('badge', b.name, 'icon', b.icon), (st ->> 'earned_at')::timestamptz)
      on conflict (user_id, kind, ref) do update set occurred_at = excluded.occurred_at, payload = excluded.payload;
    else
      delete from public.user_badges where user_id = u and badge_id = b.id and source = 'auto';
      delete from public.activity where user_id = u and kind = 'badge' and ref = b.id::text
        and not exists (select 1 from public.user_badges x where x.user_id = u and x.badge_id = b.id);
    end if;
  end loop;
end $$;

-- All visible badges, earned or not, with progress.
create or replace function public.my_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'icon', b.icon,
        'category', b.category, 'earned_at', ub.earned_at,
        'progress', case when ub.user_id is null and b.rule_type <> 'manual' then public._badge_status(uid, b) end
      ) order by b.position, b.name)
    from public.badges b
    left join public.user_badges ub on ub.badge_id = b.id and ub.user_id = uid
    where not b.is_hidden
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Friends leaderboard: me and my friends, same privacy rules as the public one.
-- ---------------------------------------------------------------------------
create or replace function public.friends_leaderboard(p_period text default 'week')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  if p_period not in ('week', 'month', 'all') then raise exception 'unknown period %', p_period using errcode = '22023'; end if;
  perform public._refresh_leaderboard();
  return (
    with circle as (
      select uid as user_id
      union
      select case when f.user_a = uid then f.user_b else f.user_a end
      from public.friendships f where (f.user_a = uid or f.user_b = uid) and f.status = 'accepted'
    ),
    base as (
      select c.user_id,
        coalesce(case p_period when 'week' then t.week when 'month' then t.month else t.total end, 0) as points,
        coalesce(t.total, 0) as total,
        c.user_id = uid or public._on_leaderboards(c.user_id) as visible
      from circle c left join public.leaderboard_totals t on t.user_id = c.user_id
    ),
    ranked as (
      select b.*, p.username, p.avatar_url,
        rank() over (order by b.points desc) as rank,
        row_number() over (order by b.points desc, p.username) as pos
      from base b join public.profiles p on p.id = b.user_id
      where b.visible
    )
    select jsonb_build_object(
      'period', p_period,
      'refreshed_at', (select refreshed_at from public.leaderboard_state where id = 1),
      'friends', (select count(*) - 1 from circle),
      'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'rank', r.rank, 'username', r.username, 'avatar_url', r.avatar_url,
          'level', (public.level_for(r.total) ->> 'level')::int, 'points', r.points, 'is_me', r.user_id = uid
        ) order by r.pos) from ranked r), '[]'::jsonb)
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Feed: my own items and those of friends who share with friends. PR weights
-- only if the owner allows it. Never bodyweight, photos, AI feedback or chats
-- (those aren't in activity at all).
-- ---------------------------------------------------------------------------
create or replace function public._can_see_activity(viewer uuid, owner uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select viewer = owner or (
    public._are_friends(viewer, owner) and not public._blocked(viewer, owner) and public._social_ok(owner)
    and coalesce((select activity_visibility from public.privacy_settings where user_id = owner), 'friends') = 'friends'
  )
$$;

create or replace function public._feed_item(a public.activity, viewer uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'occurred_at', a.occurred_at, 'is_mine', a.user_id = viewer,
    'user', public._user_card(a.user_id),
    'payload', case
      when a.kind = 'pr' and a.user_id <> viewer
           and not coalesce((select pr_show_weight from public.privacy_settings where user_id = a.user_id), true)
      then a.payload - 'weight_kg'
      else a.payload end,
    'reactions', coalesce((select jsonb_object_agg(emoji, n) from (
        select r.emoji, count(*) as n from public.activity_reactions r where r.activity_id = a.id group by r.emoji
      ) x), '{}'::jsonb),
    'my_reaction', (select emoji from public.activity_reactions r where r.activity_id = a.id and r.user_id = viewer)
  )
$$;

create or replace function public.feed(p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  return coalesce((
    select jsonb_agg(public._feed_item(a, uid) order by a.occurred_at desc, a.id)
    from (
      select a.* from public.activity a
      where (a.user_id = uid or a.user_id in (
              select case when f.user_a = uid then f.user_b else f.user_a end
              from public.friendships f where (f.user_a = uid or f.user_b = uid) and f.status = 'accepted'))
        and public._can_see_activity(uid, a.user_id)
        and (p_before is null or a.occurred_at < p_before)
      order by a.occurred_at desc, a.id
      limit least(greatest(p_limit, 1), 50)
    ) a
  ), '[]'::jsonb);
end $$;

-- p_emoji null removes my reaction.
create or replace function public.react(p_activity uuid, p_emoji text default '💪')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
  a public.activity := (select x from public.activity x where id = p_activity);
begin
  if a.id is null or not public._can_see_activity(uid, a.user_id) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  if p_emoji is null then
    delete from public.activity_reactions where activity_id = a.id and user_id = uid;
  else
    insert into public.activity_reactions (activity_id, user_id, emoji) values (a.id, uid, p_emoji)
    on conflict (activity_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
  return public._feed_item(a, uid);
end $$;

-- A user's page: username, avatar, level, streak and badges for anyone who can
-- find them; recent activity for friends (if shared).
create or replace function public.user_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
  u uuid := (select id from public.profiles where username = lower(btrim(p_username)));
  rel text;
begin
  if u is null or (u <> uid and (public._blocked(uid, u) and not exists (
        select 1 from public.user_blocks where blocker = uid and blocked = u)) )
     or (u <> uid and not public._social_ok(u)) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  rel := case when u = uid then 'me' else public._relation(uid, u) end;
  return public._user_card(u) || jsonb_build_object(
    'relation', rel,
    'streak', public._streak(u) - 'this_week_sessions' - 'goal',
    'badges', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'icon', b.icon, 'earned_at', ub.earned_at)
                                         order by ub.earned_at desc)
                        from public.user_badges ub join public.badges b on b.id = ub.badge_id
                        where ub.user_id = u and not b.is_hidden), '[]'::jsonb),
    'activity', case when rel in ('friends', 'me') and public._can_see_activity(uid, u) then coalesce((
        select jsonb_agg(public._feed_item(a, uid) order by a.occurred_at desc)
        from (select * from public.activity where user_id = u order by occurred_at desc limit 10) a
      ), '[]'::jsonb) end,
    'activity_hidden', rel = 'friends' and not public._can_see_activity(uid, u)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Challenges. Days are Europe/Madrid days; a challenge ends at midnight after
-- its end date. Scores come from workouts that count and the points ledger.
-- ---------------------------------------------------------------------------
create or replace function public._madrid_today()
returns date
language sql
stable
set search_path = ''
as $$ select public._points_day(now()) $$;

create or replace function public._challenge_score(c public.challenges, u uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case c.metric
    when 'points' then (select coalesce(sum(points), 0) from public.points_ledger
                        where user_id = u and day between c.start_date and c.end_date and source_type <> 'challenge')
    when 'workouts' then (select count(*) from public.workouts w where w.user_id = u
                          and public._points_day(w.started_at) between c.start_date and c.end_date and public._workout_counts(w.id))
    else (select count(*) from public.workout_sets s join public.workouts w on w.id = s.workout_id
          where w.user_id = u and s.set_type <> 'warmup' and public._workout_counts(w.id)
            and public._points_day(w.started_at) between c.start_date and c.end_date
            and (c.metric = 'sets' or s.exercise_id = c.exercise_id))
  end
$$;

create or replace function public._can_see_challenge(c public.challenges, u uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (c.kind = 'global' and not c.is_hidden)
      or exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = u)
      or public.is_admin()
$$;

-- Final results for challenges whose last day is over: scores, ranks, and the
-- winners' rewards (points and/or badge). Runs once per challenge.
create or replace function public._finalize_challenges()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  w record;
  n integer := 0;
  tz text := (select timezone from public.points_settings where id = 1);
begin
  for c in select * from public.challenges where finalized_at is null and end_date < public._madrid_today() for update skip locked loop
    update public.challenge_participants p set final_score = public._challenge_score(c, p.user_id)
    where p.challenge_id = c.id and p.status = 'joined';
    update public.challenge_participants p set final_rank = r.rank
    from (select user_id, rank() over (order by final_score desc) as rank from public.challenge_participants
          where challenge_id = c.id and status = 'joined') r
    where p.challenge_id = c.id and p.user_id = r.user_id;
    for w in select user_id, final_score from public.challenge_participants
             where challenge_id = c.id and status = 'joined' and final_rank = 1 and final_score > 0 loop
      if c.reward_points > 0 then
        insert into public.points_ledger (user_id, points, reason, source_type, source_id, earned_at, day, details)
        values (w.user_id, c.reward_points, 'challenge', 'challenge', c.id::text,
                ((c.end_date + 1)::timestamp at time zone tz) - interval '1 second', c.end_date,
                jsonb_build_object('challenge', c.title))
        on conflict (user_id, reason, source_type, source_id) do nothing;
      end if;
      if c.reward_badge_id is not null then
        insert into public.user_badges (user_id, badge_id, earned_at, source)
        values (w.user_id, c.reward_badge_id, ((c.end_date + 1)::timestamp at time zone tz), 'challenge')
        on conflict (user_id, badge_id) do nothing;
      end if;
      insert into public.activity (user_id, kind, ref, payload, occurred_at)
      values (w.user_id, 'challenge_win', c.id::text,
              jsonb_build_object('challenge', c.title, 'score', w.final_score, 'metric', c.metric),
              ((c.end_date + 1)::timestamp at time zone tz))
      on conflict (user_id, kind, ref) do nothing;
      perform public._evaluate_badges(w.user_id);
      perform public._refresh_level_activity(w.user_id);
    end loop;
    update public.challenges set finalized_at = now() where id = c.id;
    update public.leaderboard_state set dirty = true where id = 1;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public._challenge_json(c public.challenges, uid uuid, with_ranking boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'title', c.title, 'description', c.description, 'metric', c.metric,
    'exercise', (select name from public.exercises where id = c.exercise_id), 'exercise_id', c.exercise_id,
    'goal', c.goal, 'start_date', c.start_date, 'end_date', c.end_date,
    'ends_at', ((c.end_date + 1)::timestamp at time zone (select timezone from public.points_settings where id = 1)),
    'reward_points', c.reward_points,
    'reward_badge', (select name from public.badges where id = c.reward_badge_id),
    'state', case when c.finalized_at is not null or c.end_date < public._madrid_today() then 'finished'
                  when c.start_date > public._madrid_today() then 'upcoming' else 'active' end,
    'created_by', public._username(c.created_by), 'is_mine', c.created_by = uid,
    'my_status', (select status from public.challenge_participants where challenge_id = c.id and user_id = uid),
    'my_score', case when exists (select 1 from public.challenge_participants where challenge_id = c.id and user_id = uid and status = 'joined')
                     then coalesce((select final_score from public.challenge_participants where challenge_id = c.id and user_id = uid and c.finalized_at is not null),
                                   public._challenge_score(c, uid)) end,
    'participants', (select count(*) from public.challenge_participants where challenge_id = c.id and status = 'joined'),
    'ranking', case when with_ranking then coalesce((
        select jsonb_agg(jsonb_build_object('rank', r.rank, 'score', r.score, 'is_me', r.user_id = uid,
                                            'winner', c.finalized_at is not null and r.rank = 1 and r.score > 0,
                                            'status', r.status) || public._user_card(r.user_id) order by r.rank, r.uname)
        from (
          select x.*, case when x.status = 'joined' then rank() over (partition by x.status = 'joined' order by x.score desc) end as rank
          from (
            select p.user_id, p.status, public._username(p.user_id) as uname,
              case when c.finalized_at is not null then p.final_score
                   when p.status = 'joined' then public._challenge_score(c, p.user_id) end as score
            from public.challenge_participants p
            where p.challenge_id = c.id and p.status <> 'declined' and (public._social_ok(p.user_id) or p.user_id = uid)
              and not public._blocked(uid, p.user_id)
          ) x
        ) r
      ), '[]'::jsonb) end
  )
$$;

create or replace function public.challenges_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  perform public._finalize_challenges();
  return coalesce((
    select jsonb_agg(public._challenge_json(c, uid, false) order by (c.end_date < public._madrid_today()), c.end_date)
    from public.challenges c
    where public._can_see_challenge(c, uid) and coalesce((select status from public.challenge_participants
                                                          where challenge_id = c.id and user_id = uid), '') <> 'declined'
      and c.end_date >= public._madrid_today() - 60
  ), '[]'::jsonb);
end $$;

create or replace function public.challenge_detail(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
  c public.challenges;
begin
  perform public._finalize_challenges();
  select * into c from public.challenges where id = p_id;
  if c.id is null or not public._can_see_challenge(c, uid) then
    raise exception 'Challenge not found.' using errcode = 'P0002';
  end if;
  return public._challenge_json(c, uid, true);
end $$;

-- p_challenge: {title, description, metric, exercise_id, goal, start_date, end_date}
create or replace function public.create_friend_challenge(p_challenge jsonb, p_invite uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
  new_id uuid;
  f uuid;
  start_d date := (p_challenge ->> 'start_date')::date;
begin
  if start_d < public._madrid_today() then raise exception 'Start today or later.' using errcode = '22023'; end if;
  if coalesce(array_length(p_invite, 1), 0) = 0 then raise exception 'Invite at least one friend.' using errcode = '22023'; end if;
  if array_length(p_invite, 1) > 20 then raise exception 'Invite at most 20 friends.' using errcode = '22023'; end if;
  perform public._rate_limit(uid, 'challenge', 5, 10);
  insert into public.challenges (kind, title, description, metric, exercise_id, goal, start_date, end_date, created_by)
  values ('friend', btrim(p_challenge ->> 'title'), nullif(btrim(p_challenge ->> 'description'), ''), p_challenge ->> 'metric',
          nullif(p_challenge ->> 'exercise_id', '')::uuid, nullif(p_challenge ->> 'goal', '')::numeric,
          start_d, (p_challenge ->> 'end_date')::date, uid)
  returning id into new_id;
  insert into public.challenge_participants (challenge_id, user_id, status, joined_at) values (new_id, uid, 'joined', now());
  foreach f in array p_invite loop
    perform public.invite_to_challenge(new_id, f);
  end loop;
  return new_id;
end $$;

create or replace function public.invite_to_challenge(p_challenge uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
  c public.challenges := (select x from public.challenges x where id = p_challenge);
begin
  if c.id is null or c.kind <> 'friend' or c.created_by <> uid then raise exception 'Challenge not found.' using errcode = 'P0002'; end if;
  if c.end_date < public._madrid_today() then raise exception 'This challenge is over.' using errcode = '22023'; end if;
  if not public._are_friends(uid, p_user) or public._blocked(uid, p_user) then
    raise exception 'You can only invite friends.' using errcode = '42501';
  end if;
  insert into public.challenge_participants (challenge_id, user_id, status, invited_by)
  values (c.id, p_user, 'invited', uid) on conflict do nothing;
  perform public._notify(p_user, 'challenge_invite', c.id::text, 'Challenge invite',
    public._username(uid) || ' invited you to “' || c.title || '”.', jsonb_build_object('url', '/challenges/' || c.id));
end $$;

-- Accept or decline an invite, join a global challenge, or leave.
create or replace function public.set_challenge_status(p_challenge uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
  c public.challenges := (select x from public.challenges x where id = p_challenge);
  cur text := (select status from public.challenge_participants where challenge_id = p_challenge and user_id = uid);
begin
  if c.id is null or not public._can_see_challenge(c, uid) then raise exception 'Challenge not found.' using errcode = 'P0002'; end if;
  if c.end_date < public._madrid_today() then raise exception 'This challenge is over.' using errcode = '22023'; end if;
  if p_status not in ('joined', 'declined') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if c.kind = 'friend' and cur is null then raise exception 'You weren''t invited.' using errcode = '42501'; end if;
  if c.kind = 'friend' and c.created_by = uid and p_status = 'declined' then
    raise exception 'You created this challenge.' using errcode = '22023';
  end if;
  if c.kind = 'global' and p_status = 'declined' then
    delete from public.challenge_participants where challenge_id = c.id and user_id = uid;
  else
    insert into public.challenge_participants (challenge_id, user_id, status, joined_at)
    values (c.id, uid, p_status, case when p_status = 'joined' then now() end)
    on conflict (challenge_id, user_id) do update set status = excluded.status, joined_at = excluded.joined_at;
  end if;
  update public.notifications set read_at = now() where user_id = uid and type = 'challenge_invite' and ref = c.id::text;
  return public._challenge_json(c, uid, true);
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create or replace function public.report_user(p_user uuid, p_reason text, p_note text default null, p_activity uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._social_uid();
begin
  if p_user = uid then raise exception 'That''s you.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if p_activity is not null and not exists (select 1 from public.activity where id = p_activity and user_id = p_user) then
    p_activity := null;
  end if;
  perform public._rate_limit(uid, 'report', 5, 10);
  insert into public.user_reports (reporter, reported_user, activity_id, reason, note)
  values (uid, p_user, p_activity, p_reason, nullif(btrim(p_note), ''));
end $$;

-- ---------------------------------------------------------------------------
-- Notifications (the app reads the table directly; RLS = own rows)
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any(p_ids))
$$;

create or replace function public.unread_notifications()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select count(*)::int from public.notifications where user_id = (select auth.uid()) and read_at is null $$;

-- ---------------------------------------------------------------------------
-- Leaderboards: an admin ban also keeps people off the boards.
-- ---------------------------------------------------------------------------
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
                      where m.user_id = p.id and (m.leaderboard_banned or m.hidden or m.banned))
  )
$$;

-- ---------------------------------------------------------------------------
-- Every 5 minutes (pg_cron): challenge results, "ending in 24h", "streak at
-- risk" on Sunday evening (Madrid), then push for new inbox entries.
-- ---------------------------------------------------------------------------
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
  -- Ends within the next 24 hours.
  for c in select * from public.challenges
           where finalized_at is null and not is_hidden
             and ((end_date + 1)::timestamp at time zone tz) between now() and now() + interval '24 hours' loop
    for p in select user_id from public.challenge_participants where challenge_id = c.id and status = 'joined' loop
      perform public._notify(p.user_id, 'challenge_ending', c.id::text, 'Challenge ends in 24 hours',
        '“' || c.title || '” ends at midnight. One more session?', jsonb_build_object('url', '/challenges/' || c.id));
    end loop;
  end loop;
  -- Sunday from 18:00: streak on the line and this week's goal not reached.
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
  if exists (select 1 from public.notifications n where n.push_sent_at is null and n.created_at > now() - interval '1 day'
             and exists (select 1 from public.push_tokens t where t.user_id = n.user_id)) then
    perform public.push_start_run();
  end if;
  return jsonb_build_object('finalized', finalized);
end $$;

-- Asks the send-push Edge Function (through pg_net) to deliver; the one-time
-- token proves the call came from here.
create or replace function public.push_start_run()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  run_id uuid;
  url text := (select functions_url from public.ai_settings where id = 1) || '/send-push';
begin
  insert into public.push_runs (token_hash) values (extensions.digest(token, 'sha256')) returning id into run_id;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using url, jsonb_build_object('run_id', run_id, 'token', token), jsonb_build_object('Content-Type', 'application/json');
  return run_id;
exception when others then
  raise warning 'push run not started: %', sqlerrm;
  return null;
end $$;

-- The Edge Function claims the run once and gets the messages to send; they
-- are marked as sent (inbox entries stay).
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
  with pending as (
    select n.id, n.user_id, n.title, n.body, n.data from public.notifications n
    where n.push_sent_at is null and n.created_at > now() - interval '1 day'
    order by n.created_at limit 500
    for update skip locked
  ),
  marked as (
    update public.notifications n set push_sent_at = now() from pending p where n.id = p.id returning p.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('to', t.token, 'title', m.title, 'body', m.body,
                                               'data', m.data || jsonb_build_object('notification_id', m.id))), '[]'::jsonb)
  into msgs
  from marked m join public.push_tokens t on t.user_id = m.user_id;
  update public.push_runs set sent = jsonb_array_length(msgs) where id = p_run;
  return msgs;
end $$;

-- ---------------------------------------------------------------------------
-- Points rebuild (Stage 8) now keeps challenge rewards.
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

  -- Challenge rewards are kept; workout and weekly points are rebuilt.
  delete from public.points_ledger where user_id = p_user and source_type in ('workout', 'week');

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
-- Workout hook: records, flags, points (Stage 8), then feed items, badges and
-- level-ups. Edits and deletes can remove badges and feed items.
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
    perform public._refresh_workout_activity(p_user_id, other);
  end loop;
  perform public.recompute_points(p_user_id);
  perform public._refresh_workout_activity(p_user_id, p_workout_id);
  perform public._evaluate_badges(p_user_id);
  perform public._refresh_level_activity(p_user_id);
end;
$$;

-- Approving or rejecting a flagged workout also updates its feed item and badges.
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
  perform public._refresh_workout_activity(owner, p_workout);
  perform public._evaluate_badges(owner);
  perform public._refresh_level_activity(owner);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: badges, challenges, reports (checked and logged)
-- ---------------------------------------------------------------------------
create or replace function public.admin_badges()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object(
      'earned_by', (select count(*) from public.user_badges ub where ub.badge_id = b.id)) order by b.position, b.name)
    from public.badges b), '[]'::jsonb);
end $$;

-- p_badge: {name, description, icon, category, rule_type, rule, position}.
-- Admins create the simple types: workout_count, streak_weeks, total_sets,
-- pr_weight (exercise + kg), pr_bodyweight (exercise + ratio), manual.
create or replace function public.admin_save_badge(p_id uuid, p_badge jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rt text := p_badge ->> 'rule_type';
  r jsonb := coalesce(p_badge -> 'rule', '{}'::jsonb);
  result uuid;
  u uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_id is null and rt not in ('workout_count', 'streak_weeks', 'total_sets', 'pr_weight', 'pr_bodyweight', 'manual') then
    raise exception 'unsupported rule type %', rt using errcode = '22023';
  end if;
  if (rt in ('workout_count', 'total_sets') and coalesce((r ->> 'count')::numeric, 0) < 1)
     or (rt = 'streak_weeks' and coalesce((r ->> 'weeks')::numeric, 0) < 1)
     or (rt = 'pr_weight' and (coalesce((r ->> 'kg')::numeric, 0) <= 0
                               or not exists (select 1 from public.exercises where id = nullif(r ->> 'exercise_id', '')::uuid or slug = r ->> 'exercise')))
     or (rt = 'pr_bodyweight' and (coalesce((r ->> 'ratio')::numeric, 0) <= 0 or (r ->> 'ratio')::numeric > 5
                               or not exists (select 1 from public.exercises where id = nullif(r ->> 'exercise_id', '')::uuid or slug = r ->> 'exercise'))) then
    raise exception 'check the rule values' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.badges (name, description, icon, category, rule_type, rule, position)
    values (btrim(p_badge ->> 'name'), btrim(p_badge ->> 'description'), coalesce(nullif(p_badge ->> 'icon', ''), 'ribbon-outline'),
            coalesce(nullif(p_badge ->> 'category', ''), 'milestone'), rt, r, coalesce((p_badge ->> 'position')::smallint, 100))
    returning id into result;
  else
    update public.badges set
      name = btrim(p_badge ->> 'name'), description = btrim(p_badge ->> 'description'),
      icon = coalesce(nullif(p_badge ->> 'icon', ''), icon), category = coalesce(nullif(p_badge ->> 'category', ''), category),
      rule_type = coalesce(rt, rule_type), rule = coalesce(p_badge -> 'rule', rule),
      position = coalesce((p_badge ->> 'position')::smallint, position), updated_at = now()
    where id = p_id returning id into result;
    if result is null then raise exception 'badge % not found', p_id using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action(case when p_id is null then 'badge.create' else 'badge.update' end,
    'badge', result::text, p_badge);
  -- Award (or remove) the changed badge for everyone now.
  for u in select distinct user_id from public.workouts loop
    perform public._evaluate_badges(u);
  end loop;
  return result;
end $$;

create or replace function public.admin_set_badge_hidden(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.badges set is_hidden = p_hidden, updated_at = now() where id = p_id;
  if not found then raise exception 'badge % not found', p_id using errcode = 'P0002'; end if;
  perform public.log_admin_action('badge.hidden', 'badge', p_id::text, jsonb_build_object('hidden', p_hidden));
end $$;

create or replace function public.admin_challenges()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public._my_uid();
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform public._finalize_challenges();
  return coalesce((select jsonb_agg(public._challenge_json(c, uid, false) || jsonb_build_object('is_hidden', c.is_hidden)
                                    order by c.start_date desc)
                   from public.challenges c where c.kind = 'global'), '[]'::jsonb);
end $$;

-- Global challenges. p_challenge: {title, description, metric, exercise_id,
-- goal, start_date, end_date, reward_points, reward_badge_id}.
create or replace function public.admin_save_challenge(p_id uuid, p_challenge jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.challenges (kind, title, description, metric, exercise_id, goal, start_date, end_date,
                                   reward_points, reward_badge_id, created_by)
    values ('global', btrim(p_challenge ->> 'title'), nullif(btrim(p_challenge ->> 'description'), ''), p_challenge ->> 'metric',
            nullif(p_challenge ->> 'exercise_id', '')::uuid, nullif(p_challenge ->> 'goal', '')::numeric,
            (p_challenge ->> 'start_date')::date, (p_challenge ->> 'end_date')::date,
            coalesce((p_challenge ->> 'reward_points')::int, 0), nullif(p_challenge ->> 'reward_badge_id', '')::uuid,
            (select auth.uid()))
    returning id into result;
  else
    update public.challenges set
      title = btrim(p_challenge ->> 'title'), description = nullif(btrim(p_challenge ->> 'description'), ''),
      metric = p_challenge ->> 'metric', exercise_id = nullif(p_challenge ->> 'exercise_id', '')::uuid,
      goal = nullif(p_challenge ->> 'goal', '')::numeric, start_date = (p_challenge ->> 'start_date')::date,
      end_date = (p_challenge ->> 'end_date')::date, reward_points = coalesce((p_challenge ->> 'reward_points')::int, 0),
      reward_badge_id = nullif(p_challenge ->> 'reward_badge_id', '')::uuid, updated_at = now()
    where id = p_id and kind = 'global' and finalized_at is null
    returning id into result;
    if result is null then raise exception 'challenge % not found or already finished', p_id using errcode = 'P0002'; end if;
  end if;
  perform public.log_admin_action(case when p_id is null then 'challenge.create' else 'challenge.update' end,
    'challenge', result::text, p_challenge);
  return result;
end $$;

create or replace function public.admin_set_challenge_hidden(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.challenges set is_hidden = p_hidden, updated_at = now() where id = p_id and kind = 'global';
  if not found then raise exception 'challenge % not found', p_id using errcode = 'P0002'; end if;
  perform public.log_admin_action('challenge.hidden', 'challenge', p_id::text, jsonb_build_object('hidden', p_hidden));
end $$;

create or replace function public.admin_reports(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'resolution', r.resolution,
      'created_at', r.created_at, 'resolved_at', r.resolved_at,
      'reporter', public._username(r.reporter),
      'reported', public._user_card(r.reported_user) || jsonb_build_object(
        'email', (select email from auth.users where id = r.reported_user),
        'leaderboard_banned', coalesce(m.leaderboard_banned, false), 'banned', coalesce(m.banned, false),
        'reports', (select count(*) from public.user_reports x where x.reported_user = r.reported_user)),
      'activity', (select jsonb_build_object('kind', a.kind, 'payload', a.payload, 'occurred_at', a.occurred_at)
                   from public.activity a where a.id = r.activity_id)
    ) order by r.created_at desc)
    from public.user_reports r left join public.user_moderation m on m.user_id = r.reported_user
    where p_status = 'all' or r.status = p_status), '[]'::jsonb);
end $$;

-- p_action: dismiss, hide_from_leaderboards, ban.
create or replace function public.admin_resolve_report(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.user_reports := (select x from public.user_reports x where id = p_id);
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if r.id is null then raise exception 'report % not found', p_id using errcode = 'P0002'; end if;
  if p_action not in ('dismiss', 'hide_from_leaderboards', 'ban') then raise exception 'unknown action %', p_action using errcode = '22023'; end if;
  if p_action <> 'dismiss' then
    insert into public.user_moderation (user_id, leaderboard_banned, banned, note, updated_by)
    values (r.reported_user, true, p_action = 'ban', nullif(btrim(p_note), ''), (select auth.uid()))
    on conflict (user_id) do update set
      leaderboard_banned = true, banned = public.user_moderation.banned or excluded.banned,
      note = coalesce(excluded.note, public.user_moderation.note), updated_by = excluded.updated_by, updated_at = now();
  end if;
  update public.user_reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
    resolution = p_action || coalesce(': ' || nullif(btrim(p_note), ''), ''), resolved_by = (select auth.uid()), resolved_at = now()
  where id = p_id;
  perform public.log_admin_action('report.' || p_action, 'user', r.reported_user::text,
    jsonb_build_object('report_id', p_id, 'reason', r.reason, 'note', p_note));
end $$;

-- Admin Users screen: the full ban too (Stage 8 had leaderboard ban and hide).
create or replace function public.admin_set_user_banned(p_user uuid, p_banned boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  insert into public.user_moderation (user_id, banned, note, updated_by)
  values (p_user, p_banned, nullif(btrim(p_note), ''), (select auth.uid()))
  on conflict (user_id) do update set banned = excluded.banned,
    note = coalesce(excluded.note, public.user_moderation.note), updated_by = excluded.updated_by, updated_at = now();
  perform public.log_admin_action('user.ban', 'user', p_user::text, jsonb_build_object('banned', p_banned, 'note', p_note));
end $$;

-- Admin Users list (Stage 8) now shows the full ban too.
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
        'banned', coalesce(m.banned, false),
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

-- ---------------------------------------------------------------------------
-- Badges, feed items and level-ups for existing workouts (once per user).
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid;
  w uuid;
begin
  for u in select distinct user_id from public.workouts
           where not exists (select 1 from public.activity a where a.user_id = workouts.user_id) loop
    for w in select id from public.workouts where user_id = u order by started_at loop
      perform public._refresh_workout_activity(u, w);
    end loop;
    perform public._evaluate_badges(u);
    perform public._refresh_level_activity(u);
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
    'public._pair(uuid, uuid)', 'public._are_friends(uuid, uuid)', 'public._blocked(uuid, uuid)',
    'public._social_ok(uuid)', 'public._rate_limit(uuid, text, integer, integer)', 'public._my_uid()',
    'public._social_uid()', 'public._notify(uuid, text, text, text, text, jsonb)', 'public._username(uuid)',
    'public._relation(uuid, uuid)', 'public._user_card(uuid)', 'public._streak(uuid)',
    'public._refresh_workout_activity(uuid, uuid)', 'public._refresh_level_activity(uuid)',
    'public._badge_status(uuid, public.badges)', 'public._evaluate_badges(uuid)',
    'public._can_see_activity(uuid, uuid)', 'public._feed_item(public.activity, uuid)', 'public._madrid_today()',
    'public._challenge_score(public.challenges, uuid)', 'public._can_see_challenge(public.challenges, uuid)',
    'public._finalize_challenges()', 'public._challenge_json(public.challenges, uuid, boolean)',
    'public.social_tick()', 'public.push_start_run()', 'public.push_claim(uuid, text)',
    'public.recompute_points(uuid)', 'public.after_workout_change(uuid, uuid, uuid[])', 'public._on_leaderboards(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.push_claim(uuid, text) to service_role';
  foreach f in array array[
    'public.search_users(text)', 'public.send_friend_request(uuid)', 'public.respond_friend_request(uuid, boolean)',
    'public.remove_friend(uuid)', 'public.block_user(uuid)', 'public.unblock_user(uuid)', 'public.my_friends()',
    'public.my_streak()', 'public.my_badges()', 'public.friends_leaderboard(text)', 'public.feed(timestamptz, integer)',
    'public.react(uuid, text)', 'public.user_profile(text)', 'public.challenges_list()', 'public.challenge_detail(uuid)',
    'public.create_friend_challenge(jsonb, uuid[])', 'public.invite_to_challenge(uuid, uuid)',
    'public.set_challenge_status(uuid, text)', 'public.report_user(uuid, text, text, uuid)',
    'public.mark_notifications_read(bigint[])', 'public.unread_notifications()',
    'public.admin_review_workout(uuid, boolean)', 'public.admin_badges()', 'public.admin_save_badge(uuid, jsonb)',
    'public.admin_set_badge_hidden(uuid, boolean)', 'public.admin_challenges()', 'public.admin_save_challenge(uuid, jsonb)',
    'public.admin_set_challenge_hidden(uuid, boolean)', 'public.admin_reports(text)',
    'public.admin_resolve_report(uuid, text, text)', 'public.admin_set_user_banned(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Schedule (needs pg_cron and pg_net, already on since Stage 6).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available: social_tick is not scheduled';
    return;
  end if;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('social-tick', '*/5 * * * *', 'select public.social_tick()');
exception when others then
  raise warning 'Could not schedule social_tick (%). Enable pg_cron and pg_net and run this file again.', sqlerrm;
end $$;
