-- Stage 9: friends and blocking, rate limits, feed privacy and reactions,
-- badges awarded and removed on edit/delete, streaks, challenge scoring and
-- results, reports, notifications and push claims.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('f9f90000-0000-0000-0000-00000000000a', 'soc-a@test.dev');
select pg_temp.new_user('f9f90000-0000-0000-0000-00000000000b', 'soc-b@test.dev');
select pg_temp.new_user('f9f90000-0000-0000-0000-00000000000c', 'soc-c@test.dev');
select pg_temp.new_user('f9f90000-0000-0000-0000-00000000000d', 'soc-d@test.dev');
select pg_temp.new_user('f9f90000-0000-0000-0000-00000000000e', 'soc-admin@test.dev');
update public.profiles set username = 'gleb_s', bodyweight_kg = 60, training_days_per_week = 3 where id = 'f9f90000-0000-0000-0000-00000000000a';
update public.profiles set username = 'anna_s', bodyweight_kg = 58, training_days_per_week = 3 where id = 'f9f90000-0000-0000-0000-00000000000b';
update public.profiles set username = 'carl_s' where id = 'f9f90000-0000-0000-0000-00000000000c';
update public.profiles set username = 'dora_s' where id = 'f9f90000-0000-0000-0000-00000000000d';
update public.profiles set username = 'soc_admin', role = 'admin' where id = 'f9f90000-0000-0000-0000-00000000000e';

create function pg_temp.u(c text) returns uuid language sql as $$ select ('f9f90000-0000-0000-0000-00000000000' || c)::uuid $$;
create function pg_temp.ex(slug text) returns uuid language sql as $$ select id from public.exercises where exercises.slug = $1 $$;
create function pg_temp.w(n int) returns uuid language sql as $$ select ('a9a90000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- Saves a workout as the user; old dates are marked as logged on time.
create function pg_temp.lift(c text, n int, at timestamptz, slug text, weight numeric, sets int default 3, minutes int default 50)
returns void language plpgsql as $$
begin
  perform pg_temp.login(pg_temp.u(c));
  perform public.save_workout(
    jsonb_build_object('id', pg_temp.w(n), 'name', 'Session ' || n, 'started_at', at,
                       'ended_at', at + make_interval(mins => minutes), 'client_updated_at', now()),
    (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', pg_temp.ex(slug), 'exercise_order', 0,
       'set_order', i, 'weight_kg', weight, 'reps', 5, 'set_type', 'normal')) from generate_series(1, sets) i));
  perform pg_temp.logout();
  if at < now() - interval '6 days' then
    update public.workouts set created_at = at where id = pg_temp.w(n);
    perform public.after_workout_change(pg_temp.u(c), pg_temp.w(n), null);
  end if;
end $$;
create function pg_temp.has_badge(c text, slug text) returns boolean language sql as $$
  select exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
                 where ub.user_id = pg_temp.u(c) and b.slug = $2)
$$;

-- Search: partial or exact, never me.
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select public.search_users('ann') -> 0 @> '{"username": "anna_s", "relation": "none"}'), 'partial username search');
select pg_temp.check((select public.search_users('anna_s') -> 0 ->> 'username' = 'anna_s'), 'exact match first');
select pg_temp.check((select jsonb_array_length(public.search_users('gleb')) = 0), 'never finds me');
select pg_temp.check((select jsonb_array_length(public.search_users('a')) = 0), 'at least 2 characters');
select pg_temp.check((select not (public.search_users('_s')::text like '%"email"%')), 'no emails in results');

-- Requests: send, see, accept; both get notified.
select public.send_friend_request(pg_temp.u('b'));
select pg_temp.check((select public.search_users('anna') -> 0 ->> 'relation' = 'outgoing'), 'request sent');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select public.my_friends() -> 'incoming' -> 0 ->> 'username' = 'gleb_s'), 'anna sees the request');
select pg_temp.check((select count(*) = 1 from public.notifications where type = 'friend_request'), 'and gets a notification');
select pg_temp.check((select public.respond_friend_request(pg_temp.u('a'), true) = 'friends'), 'accepted');
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select public.my_friends() -> 'friends' -> 0 ->> 'username' = 'anna_s'), 'friends both ways');
select pg_temp.check((select count(*) = 1 from public.notifications where type = 'friend_accepted'), 'gleb is told it was accepted');
select pg_temp.check((select count(*) = 0 from public.notifications where type = 'friend_request'), 'and can''t read anna''s notifications');
-- Cancel and decline.
select public.send_friend_request(pg_temp.u('c'));
select public.remove_friend(pg_temp.u('c'));
select pg_temp.check((select public.search_users('carl') -> 0 ->> 'relation' = 'none'), 'cancelled request');
select public.send_friend_request(pg_temp.u('c'));
select pg_temp.login(pg_temp.u('c'));
select public.respond_friend_request(pg_temp.u('a'), false);
select pg_temp.check((select jsonb_array_length(public.my_friends() -> 'incoming') = 0), 'declined request is gone');
select pg_temp.expect_error($$select public.respond_friend_request('f9f90000-0000-0000-0000-00000000000b', true)$$,
  'can''t accept a request that wasn''t sent');
-- Nobody writes friendships directly.
select pg_temp.expect_error($$insert into public.friendships (user_a, user_b, requested_by, status)
  values ('f9f90000-0000-0000-0000-00000000000a', 'f9f90000-0000-0000-0000-00000000000c', 'f9f90000-0000-0000-0000-00000000000c', 'accepted')$$,
  'friendships only through the functions');

-- Rate limit on requests (10 an hour).
select pg_temp.logout();
insert into public.social_rate_log (user_id, action) select pg_temp.u('c'), 'friend_request' from generate_series(1, 10);
select pg_temp.login(pg_temp.u('c'));
select pg_temp.expect_error($$select public.send_friend_request('f9f90000-0000-0000-0000-00000000000d')$$, 'the 11th request in an hour is refused');

-- Blocking: blocked users can't find me or send requests.
select pg_temp.login(pg_temp.u('d'));
select public.block_user(pg_temp.u('a'));
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select jsonb_array_length(public.search_users('dora')) = 0), 'blocked: they can''t find me');
select pg_temp.expect_error($$select public.send_friend_request('f9f90000-0000-0000-0000-00000000000d')$$, 'or send me a request');
select pg_temp.expect_error($$select public.user_profile('dora_s')$$, 'or open my profile');
select pg_temp.login(pg_temp.u('d'));
select pg_temp.check((select jsonb_array_length(public.search_users('gleb')) = 0), 'and I don''t see them in search');
select pg_temp.check((select public.user_profile('gleb_s') ->> 'relation' = 'blocked'), 'but can open them to unblock');
select pg_temp.check((select public.my_friends() -> 'blocked' -> 0 ->> 'username' = 'gleb_s'), 'blocked list');

-- Feed: friends see finished workouts and PRs (with weight unless hidden).
select pg_temp.lift('a', 1, now() - interval '3 hours', 'barbell_bench_press', 50);
select pg_temp.lift('a', 2, now() - interval '2 hours', 'barbell_bench_press', 55);
select pg_temp.login(pg_temp.u('b'));
create temp table fb as select public.feed() as f;
grant select on fb to authenticated;
select pg_temp.check((select exists (select 1 from fb, jsonb_array_elements(f) x where x ->> 'kind' = 'workout' and x -> 'user' ->> 'username' = 'gleb_s')),
  'a friend''s finished workout is in my feed');
select pg_temp.check((select exists (select 1 from fb, jsonb_array_elements(f) x
  where x ->> 'kind' = 'pr' and x -> 'payload' ->> 'exercise' = 'Bench Press (Barbell)' and (x -> 'payload' ->> 'weight_kg')::numeric = 55)),
  'and the PR, with the weight');
select pg_temp.check((select f::text not like '%bodyweight%' and f::text not like '%feedback%' from fb), 'never bodyweight or AI feedback');
select pg_temp.check((select exists (select 1 from fb, jsonb_array_elements(f) x where x ->> 'kind' = 'badge' and x -> 'payload' ->> 'badge' = 'First rep')),
  'badges show up too');
-- Reactions.
select public.react((select (x ->> 'id')::uuid from fb, jsonb_array_elements(f) x where x ->> 'kind' = 'pr' limit 1), '💪');
select pg_temp.check((select x -> 'reactions' ->> '💪' = '1' and x ->> 'my_reaction' = '💪'
  from jsonb_array_elements(public.feed()) x where x ->> 'kind' = 'pr'), 'reacted 💪');
select public.react((select (x ->> 'id')::uuid from fb, jsonb_array_elements(f) x where x ->> 'kind' = 'pr' limit 1), null);
select pg_temp.check((select x -> 'reactions' = '{}' from jsonb_array_elements(public.feed()) x where x ->> 'kind' = 'pr'), 'and took it back');
select pg_temp.expect_error($$insert into public.activity_reactions (activity_id, user_id) select id, auth.uid() from public.activity limit 1$$,
  'reactions only through react()');
-- Non-friends see nothing and can't react.
select pg_temp.login(pg_temp.u('c'));
select pg_temp.check((select not (public.feed()::text like '%gleb_s%')), 'non-friends don''t see my activity');
select pg_temp.expect_error(format($$select public.react(%L)$$, (select (x ->> 'id')::uuid from fb, jsonb_array_elements(f) x limit 1)),
  'or react to it');
select pg_temp.check((select public.user_profile('gleb_s') -> 'activity' = 'null'::jsonb), 'their profile of me shows no activity');
-- Privacy settings.
select pg_temp.login(pg_temp.u('a'));
insert into public.privacy_settings (user_id, pr_show_weight) values (auth.uid(), false);
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select not (x -> 'payload' ? 'weight_kg') and x -> 'payload' ->> 'exercise' = 'Bench Press (Barbell)'
  from jsonb_array_elements(public.feed()) x where x ->> 'kind' = 'pr'), 'PR weight hidden: just "new PR on Bench Press"');
select pg_temp.login(pg_temp.u('a'));
update public.privacy_settings set activity_visibility = 'nobody' where user_id = auth.uid();
select pg_temp.check((select (x -> 'payload' ? 'weight_kg') from jsonb_array_elements(public.feed()) x where x ->> 'kind' = 'pr'),
  'I still see my own items, with weights');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select not (public.feed()::text like '%gleb_s%')), 'activity set to nobody: friends see nothing');
select pg_temp.check((select (public.user_profile('gleb_s') ->> 'activity_hidden')::boolean), 'profile says activity is private');
select pg_temp.login(pg_temp.u('a'));
update public.privacy_settings set activity_visibility = 'friends', pr_show_weight = true where user_id = auth.uid();
select pg_temp.expect_error($$update public.privacy_settings set activity_visibility = 'friends' where user_id = 'f9f90000-0000-0000-0000-00000000000b'$$
  || $$ returning 1/0$$, 'can''t change someone else''s privacy');

-- "Friend beat my PR": anna's best bench is 57.5; gleb now lifts 60.
select pg_temp.lift('b', 20, now() - interval '10 days', 'barbell_bench_press', 57.5);
select pg_temp.lift('a', 3, now() - interval '1 hour', 'barbell_bench_press', 60);
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select count(*) = 1 and min(body) like 'gleb_s just lifted more than your best on Bench Press%'
  from public.notifications where type = 'pr_beaten'), 'anna is told gleb beat her best (no weights)');

-- Badges: bench your bodyweight (60 kg) earned, then lost when the workout is edited.
select pg_temp.logout();
select pg_temp.check((select pg_temp.has_badge('a', 'bench_bw') and pg_temp.has_badge('a', 'first_workout') and pg_temp.has_badge('a', 'first_pr')),
  'bench 60 kg at 60 kg bodyweight: "Bench your bodyweight", plus first workout and first PR');
select pg_temp.check((select pg_temp.has_badge('b', 'first_workout') and not pg_temp.has_badge('b', 'bench_bw')),
  'anna (58 kg, best 57.5) hasn''t benched her bodyweight yet');
select pg_temp.lift('a', 3, now() - interval '1 hour', 'barbell_bench_press', 52.5);
select pg_temp.logout();
select pg_temp.check((select not pg_temp.has_badge('a', 'bench_bw')
  and not exists (select 1 from public.activity a join public.badges b on b.id::text = a.ref where a.kind = 'badge' and b.slug = 'bench_bw')),
  'edited down to 52.5: badge and its feed item removed');
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select x -> 'progress' @> '{"current": 55, "target": 60}' from jsonb_array_elements(public.my_badges()) x
  where x ->> 'slug' = 'bench_bw'), 'locked badge shows progress: 55 of 60 kg');
select pg_temp.check((select (x ->> 'earned_at') is not null from jsonb_array_elements(public.my_badges()) x where x ->> 'slug' = 'first_workout'),
  'earned badges have the date');
select public.delete_workout(pg_temp.w(1));
select public.delete_workout(pg_temp.w(2));
select public.delete_workout(pg_temp.w(3));
select pg_temp.logout();
select pg_temp.check((select not pg_temp.has_badge('a', 'first_workout') and not exists (select 1 from public.activity where user_id = pg_temp.u('a') and kind in ('workout', 'pr'))),
  'all workouts deleted: first workout badge and feed items gone');

-- Streaks from the weekly goal (3 a week): two weeks in a row, then a gap.
select pg_temp.lift('a', 31, '2026-10-05 18:00+02', 'barbell_bench_press', 40);
select pg_temp.lift('a', 32, '2026-10-07 18:00+02', 'barbell_bench_press', 40);
select pg_temp.lift('a', 33, '2026-10-09 18:00+02', 'barbell_bench_press', 40);
select pg_temp.lift('a', 34, '2026-10-12 18:00+02', 'barbell_bench_press', 40);
select pg_temp.lift('a', 35, '2026-10-14 18:00+02', 'barbell_bench_press', 40);
select pg_temp.lift('a', 36, '2026-10-16 18:00+02', 'barbell_bench_press', 40);
select pg_temp.check((select public._streak(pg_temp.u('a')) @> '{"longest": 2, "current": 0}'), 'longest streak 2 weeks (none now)');

-- Challenges: a global one with a points reward, scored from workouts.
select pg_temp.lift('b', 41, '2026-10-06 18:00+02', 'barbell_bench_press', 40);
select pg_temp.login(pg_temp.u('a'));
select pg_temp.expect_error($$select public.admin_save_challenge(null, '{"title": "x", "metric": "workouts", "start_date": "2026-10-05", "end_date": "2026-10-11"}')$$,
  'only admins create global challenges');
select pg_temp.login(pg_temp.u('e'));
create temp table ch as select public.admin_save_challenge(null, '{"title": "October week", "metric": "workouts",
  "start_date": "2026-10-05", "end_date": "2026-10-11", "reward_points": 50}') as id;
grant select on ch to authenticated;
select pg_temp.logout();
insert into public.challenge_participants (challenge_id, user_id, status, joined_at)
select ch.id, u, 'joined', now() from ch, unnest(array[pg_temp.u('a'), pg_temp.u('b')]) u;
select pg_temp.login(pg_temp.u('b'));
create temp table cd as select public.challenge_detail((select id from ch)) as j;
grant select on cd to authenticated;
select pg_temp.check((select j ->> 'state' = 'finished' and j -> 'ranking' -> 0 @> '{"username": "gleb_s", "rank": 1, "score": 3, "winner": true}'
  and j -> 'ranking' -> 1 @> '{"username": "anna_s", "rank": 2, "score": 1}' from cd), 'final ranking: 3 workouts beat 1 (Madrid days)');
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 from public.points_ledger where user_id = pg_temp.u('a') and reason = 'challenge' and points = 50),
  'the winner gets the 50-point bonus');
select pg_temp.logout();
select pg_temp.check((select pg_temp.has_badge('a', 'challenge_winner')), 'and the Champion badge');
select pg_temp.logout();
select public.recompute_points(pg_temp.u('a'));
select public._finalize_challenges();
select pg_temp.check((select count(*) = 1 from public.points_ledger where user_id = pg_temp.u('a') and reason = 'challenge'),
  'rebuilding points keeps the bonus, and finishing runs only once');
select pg_temp.check((select exists (select 1 from public.activity where user_id = pg_temp.u('a') and kind = 'challenge_win')), 'win in the feed');
select pg_temp.check((select count(*) = 1 from public.admin_actions where action = 'challenge.create'), 'challenge creation logged');

-- Friend challenges: only friends can be invited; invite → notification → accept.
select pg_temp.login(pg_temp.u('a'));
select pg_temp.expect_error($$select public.create_friend_challenge('{"title": "Bench-off", "metric": "exercise", "exercise_id": ""}',
  array['f9f90000-0000-0000-0000-00000000000c']::uuid[])$$, 'can''t invite non-friends');
create temp table fc as select public.create_friend_challenge(jsonb_build_object('title', 'Bench-off', 'metric', 'exercise',
  'exercise_id', pg_temp.ex('barbell_bench_press'), 'goal', 12, 'start_date', (now() at time zone 'Europe/Madrid')::date, 'end_date', (now() at time zone 'Europe/Madrid')::date),
  array[pg_temp.u('b')]) as id;
grant select on fc to authenticated;
select pg_temp.login(pg_temp.u('c'));
select pg_temp.expect_error($$select public.challenge_detail((select id from fc))$$, 'others can''t see a friend challenge');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select count(*) = 1 from public.notifications where type = 'challenge_invite'), 'invite notification');
select pg_temp.check((select public.set_challenge_status((select id from fc), 'joined') ->> 'my_status' = 'joined'), 'accepted the invite');
select pg_temp.logout();
select public.social_tick();
select pg_temp.check((select count(*) = 2 from public.notifications where type = 'challenge_ending'),
  'ends at midnight Madrid: both get "ends in 24 hours" (once)');
select public.social_tick();
select pg_temp.check((select count(*) = 2 from public.notifications where type = 'challenge_ending'), 'not twice');
select pg_temp.lift('b', 42, now() - interval '30 minutes', 'barbell_bench_press', 40, 4);
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select public.challenge_detail((select id from fc)) -> 'ranking' -> 0 @> '{"username": "anna_s", "score": 4}'),
  'live ranking: 4 bench sets today');

-- Friends leaderboard: me and friends only.
select pg_temp.check((select (select array_agg(x ->> 'username' order by x ->> 'username') from jsonb_array_elements(public.friends_leaderboard('all') -> 'entries') x)
  = '{anna_s,gleb_s}'), 'friends board: me and anna, not carl or dora');

-- Notification settings.
select pg_temp.login(pg_temp.u('b'));
insert into public.notification_settings (user_id, friend_request) values (auth.uid(), false);
select pg_temp.login(pg_temp.u('d'));
select public.unblock_user(pg_temp.u('a'));
select public.send_friend_request(pg_temp.u('b'));
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 from public.notifications where user_id = pg_temp.u('b') and type = 'friend_request'),
  'friend requests turned off: no new notification');
select pg_temp.login(pg_temp.u('b'));
select public.mark_notifications_read();
select pg_temp.check((select public.unread_notifications() = 0), 'mark all read');

-- Reports and moderation.
select public.report_user(pg_temp.u('d'), 'spam', 'Keeps sending requests');
select pg_temp.expect_error($$select * from public.user_reports$$, 'reports aren''t readable by users');
select pg_temp.expect_error($$select public.admin_reports()$$, 'or listed');
select pg_temp.login(pg_temp.u('e'));
select pg_temp.check((select public.admin_reports() -> 0 @> '{"reason": "spam", "reporter": "anna_s", "note": "Keeps sending requests"}'
  and public.admin_reports() -> 0 -> 'reported' ->> 'username' = 'dora_s'), 'admin sees the report');
select public.admin_resolve_report((select (public.admin_reports() -> 0 ->> 'id')::uuid), 'ban', 'Spam');
select pg_temp.check((select count(*) = 1 from public.admin_actions where action = 'report.ban'), 'logged');
select pg_temp.login(pg_temp.u('d'));
select pg_temp.expect_error($$select public.send_friend_request('f9f90000-0000-0000-0000-00000000000c')$$, 'banned: no social actions');
select pg_temp.login(pg_temp.u('c'));
select pg_temp.check((select jsonb_array_length(public.search_users('dora')) = 0), 'and not findable');

-- Admin badges.
select pg_temp.login(pg_temp.u('b'));
select pg_temp.expect_error($$select public.admin_save_badge(null, '{"name": "x", "description": "y", "rule_type": "workout_count", "rule": {"count": 1}}')$$,
  'only admins create badges');
select pg_temp.login(pg_temp.u('e'));
select public.admin_save_badge(null, jsonb_build_object('name', 'Bench 40', 'description', 'Bench 40 kg.', 'rule_type', 'pr_weight',
  'rule', jsonb_build_object('exercise_id', pg_temp.ex('barbell_bench_press'), 'kg', 40)));
select pg_temp.expect_error($$select public.admin_save_badge(null, '{"name": "x", "description": "y", "rule_type": "level", "rule": {"level": 3}}')$$,
  'only the simple rule types');
select pg_temp.logout();
select pg_temp.check((select exists (select 1 from public.user_badges ub join public.badges b on b.id = ub.badge_id
  where b.name = 'Bench 40' and ub.user_id = pg_temp.u('b'))), 'new badge awarded to everyone who qualifies');
select pg_temp.login(pg_temp.u('e'));
select public.admin_set_badge_hidden((select id from public.badges where name = 'Bench 40'), true);
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select not (public.my_badges()::text like '%Bench 40%')), 'hidden badge not shown');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.admin_actions where action in ('badge.create', 'badge.hidden')), 'badge changes logged');

-- Push: only with the one-time token; messages for users with a device.
insert into public.web_push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/anna', pg_temp.u('b'), repeat('B', 87), repeat('a', 22));
insert into public.push_runs (id, token_hash) values ('b9b90000-0000-0000-0000-000000000001', extensions.digest('push-secret', 'sha256'));
select pg_temp.expect_error($$select public.push_claim('b9b90000-0000-0000-0000-000000000001', 'guess')$$, 'push run needs the token');
select pg_temp.check((select jsonb_array_length(public.push_claim('b9b90000-0000-0000-0000-000000000001', 'push-secret')) >= 1), 'claims anna''s messages');
select pg_temp.check((select count(*) = 0 from public.notifications where user_id = pg_temp.u('b') and push_sent_at is null), 'marked as sent');
select pg_temp.expect_error($$select public.push_claim('b9b90000-0000-0000-0000-000000000001', 'push-secret')$$, 'only once');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.expect_error($$select public.push_claim('b9b90000-0000-0000-0000-000000000001', 'push-secret')$$, 'clients can''t claim');

rollback;
\echo 'social tests passed'
