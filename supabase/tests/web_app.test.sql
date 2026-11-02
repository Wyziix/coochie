-- Stage 11: web push subscriptions, rest timer pushes, push claims, weekly
-- report notice, default rest time, export, and account deletion (nothing of
-- the user is left anywhere; the last admin can't be deleted).
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

create function pg_temp.u(c text) returns uuid language sql as $$ select ('fbfb0000-0000-0000-0000-00000000000' || c)::uuid $$;
create function pg_temp.ex(slug text) returns uuid language sql as $$ select id from public.exercises where exercises.slug = $1 $$;
create function pg_temp.lift(c text, wid uuid, at timestamptz, ex uuid, weight numeric) returns void language plpgsql as $$
begin
  perform pg_temp.login(pg_temp.u(c));
  perform public.save_workout(
    jsonb_build_object('id', wid, 'name', 'Session', 'started_at', at, 'ended_at', at + interval '50 minutes',
                       'client_updated_at', now(), 'notes', 'felt strong'),
    (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'exercise_id', ex, 'exercise_order', 0,
       'set_order', i, 'weight_kg', weight, 'reps', 5, 'set_type', 'normal')) from generate_series(1, 3) i));
  perform pg_temp.logout();
end $$;

select pg_temp.new_user(pg_temp.u('a'), 'gone@test.dev');
select pg_temp.new_user(pg_temp.u('b'), 'stays@test.dev');
select pg_temp.new_user(pg_temp.u('c'), 'boss@test.dev');
update public.profiles set username = 'zz_gone_user', bodyweight_kg = 70, training_days_per_week = 3 where id = pg_temp.u('a');
update public.profiles set username = 'bea_stays', bodyweight_kg = 60, training_days_per_week = 3 where id = pg_temp.u('b');
update public.profiles set username = 'boss_admin', role = 'admin' where id = pg_temp.u('c');
-- Only these three exist in this test's view of admins.
update public.profiles set role = 'user' where role = 'admin' and id <> pg_temp.u('c');

-- ---------------------------------------------------------------------------
-- Web push subscriptions
-- ---------------------------------------------------------------------------
select pg_temp.login(pg_temp.u('a'));
select public.save_web_push('https://fcm.googleapis.com/fcm/send/dev-1', repeat('B', 87), repeat('a', 22), 'Chrome Android');
select pg_temp.check((select count(*) = 1 from public.web_push_subscriptions), 'subscription saved');
select pg_temp.expect_error($$select public.save_web_push('http://insecure', repeat('B', 87), repeat('a', 22))$$, 'https endpoints only');
select pg_temp.expect_error($$select public.save_web_push('https://x', 'short', repeat('a', 22))$$, 'keys are checked');
select pg_temp.expect_error($$insert into public.web_push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://y', 'fbfb0000-0000-0000-0000-00000000000a', repeat('B', 87), repeat('a', 22))$$,
  'no direct writes');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select count(*) = 0 from public.web_push_subscriptions), 'others can''t see my subscription');
select public.delete_web_push('https://fcm.googleapis.com/fcm/send/dev-1');
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 from public.web_push_subscriptions), 'or delete it');
select pg_temp.login(pg_temp.u('b'));
select public.save_web_push('https://web.push.apple.com/dev-2', repeat('C', 87), repeat('b', 22));
select public.save_web_push('https://fcm.googleapis.com/fcm/send/dev-1', repeat('B', 87), repeat('a', 22));
select pg_temp.logout();
select pg_temp.check((select user_id = pg_temp.u('b') from public.web_push_subscriptions where endpoint like '%dev-1'),
  'a browser that signs in to another account moves with it');
update public.web_push_subscriptions set user_id = pg_temp.u('a') where endpoint like '%dev-1';
select pg_temp.login(pg_temp.u('a'));
select public.delete_web_push('https://fcm.googleapis.com/fcm/send/dev-1');
select pg_temp.check((select count(*) = 0 from public.web_push_subscriptions), 'I can remove mine');
select public.save_web_push('https://fcm.googleapis.com/fcm/send/dev-1', repeat('B', 87), repeat('a', 22));
select pg_temp.logout();
set local role anon;
select pg_temp.expect_error($$select public.save_web_push('https://z', repeat('B', 87), repeat('a', 22))$$, 'not signed out');
reset role;

-- ---------------------------------------------------------------------------
-- Rest timer pushes
-- ---------------------------------------------------------------------------
select pg_temp.login(pg_temp.u('c'));
select pg_temp.check((select not public.schedule_push('rest', 90, 'Rest is over', 'Next set')), 'no device: nothing scheduled');
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select public.schedule_push('rest', 90, 'Rest is over', 'Bench press: set 2')), 'scheduled');
select pg_temp.check((select public.schedule_push('rest', 120, 'Rest is over', 'Bench press: set 3')), 'rescheduled');
select pg_temp.expect_error($$select public.schedule_push('rest', 2, 't', 'b')$$, 'at least 5 seconds');
select pg_temp.expect_error($$select public.schedule_push('rest', 3600, 't', 'b')$$, 'at most 30 minutes');
select pg_temp.expect_error($$select * from public.scheduled_pushes$$, 'the table is server-only');
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 and min(body) = 'Bench press: set 3' from public.scheduled_pushes), 'one per tag, the latest');
select pg_temp.login(pg_temp.u('a'));
select public.cancel_push('rest');
select pg_temp.logout();
select pg_temp.check((select count(*) = 0 from public.scheduled_pushes), 'cancelled when the rest is skipped');
insert into public.notification_settings (user_id, rest_timer) values (pg_temp.u('a'), false)
  on conflict (user_id) do update set rest_timer = false;
select pg_temp.login(pg_temp.u('a'));
select pg_temp.check((select not public.schedule_push('rest', 90, 't', 'b')), 'off in settings: nothing scheduled');
select pg_temp.logout();
update public.notification_settings set rest_timer = true where user_id = pg_temp.u('a');

-- Due pushes and inbox entries go out once, to every device of the user.
select pg_temp.check((select not public.push_due()), 'nothing due: no run');
insert into public.scheduled_pushes (user_id, tag, send_at, title, body, data)
values (pg_temp.u('a'), 'rest', now() - interval '1 second', 'Rest is over', 'Squat: set 4', '{"url": "/workouts/active"}');
insert into public.scheduled_pushes (user_id, tag, send_at, title, body)
values (pg_temp.u('b'), 'rest', now() + interval '1 minute', 'Rest is over', 'Later');
select pg_temp.check((select public.push_due()), 'something due: a run starts');
select public._notify(pg_temp.u('b'), 'friend_request', 'x1', 'New friend request', 'Someone wants to be friends.', '{"url": "/friends"}');
select public._notify(pg_temp.u('c'), 'friend_request', 'x2', 'New friend request', 'No device.', '{}');
insert into public.push_runs (id, token_hash) values ('fbfb1111-0000-0000-0000-000000000001', extensions.digest('run-1', 'sha256'));
create temp table claim1 as select public.push_claim('fbfb1111-0000-0000-0000-000000000001', 'run-1') as m;
select pg_temp.check((select jsonb_array_length(m) = 2 from claim1), 'one due rest push + one inbox entry (users with a device)');
select pg_temp.check((select m @> '[{"body": "Squat: set 4", "tag": "rest", "endpoint": "https://fcm.googleapis.com/fcm/send/dev-1"}]' from claim1),
  'the rest push goes to the device');
select pg_temp.check((select m @> '[{"title": "New friend request", "endpoint": "https://web.push.apple.com/dev-2", "tag": "friend_request:x1"}]' from claim1),
  'inbox entries go out as push too');
select pg_temp.check((select count(*) = 1 from public.notifications where user_id = pg_temp.u('c') and push_sent_at is null),
  'no device: stays in the inbox only');
select pg_temp.check((select sent_at is null from public.scheduled_pushes where user_id = pg_temp.u('b')), 'not due yet: not sent');
select pg_temp.expect_error($$select public.push_claim('fbfb1111-0000-0000-0000-000000000001', 'run-1')$$, 'a run is claimed once');
insert into public.push_runs (id, token_hash) values ('fbfb1111-0000-0000-0000-000000000002', extensions.digest('run-2', 'sha256'));
select pg_temp.check((select public.push_claim('fbfb1111-0000-0000-0000-000000000002', 'run-2') = '[]'::jsonb), 'nothing is sent twice');
select public.push_forget(array['https://web.push.apple.com/dev-2']);
select pg_temp.check((select count(*) = 0 from public.web_push_subscriptions where user_id = pg_temp.u('b')), 'gone subscriptions are removed');
select pg_temp.login(pg_temp.u('a'));
select pg_temp.expect_error($$select public.push_claim('fbfb1111-0000-0000-0000-000000000002', 'run-2')$$, 'clients can''t claim');
select pg_temp.expect_error($$select public.push_forget(array['x'])$$, 'or forget subscriptions');
select pg_temp.expect_error($$select public.push_due()$$, 'or start runs');
select pg_temp.logout();

-- Weekly report notice (inbox + push), off in settings means none.
select public.ai_notify_weekly_report(pg_temp.u('a'), 'fbfb2222-0000-0000-0000-000000000001', repeat('Good week. ', 20));
select pg_temp.check((select count(*) = 1 and min(title) = 'Your weekly report is ready' and max(char_length(body)) <= 110
                      and min(data ->> 'url') = '/reports/fbfb2222-0000-0000-0000-000000000001'
                      from public.notifications where user_id = pg_temp.u('a') and type = 'weekly_report'), 'weekly report in the inbox');
update public.notification_settings set weekly_report = false where user_id = pg_temp.u('a');
select public.ai_notify_weekly_report(pg_temp.u('a'), 'fbfb2222-0000-0000-0000-000000000002', 'x');
select pg_temp.check((select count(*) = 1 from public.notifications where user_id = pg_temp.u('a') and type = 'weekly_report'), 'turned off: no notice');

-- Default rest time
select pg_temp.login(pg_temp.u('a'));
update public.profiles set default_rest_seconds = 150 where id = pg_temp.u('a');
select pg_temp.check((select default_rest_seconds = 150 from public.profiles where id = pg_temp.u('a')), 'default rest saved');
select pg_temp.expect_error($$update public.profiles set default_rest_seconds = 5000 where id = 'fbfb0000-0000-0000-0000-00000000000a'$$, 'within 0-15 minutes');
select pg_temp.logout();

-- ---------------------------------------------------------------------------
-- A full account: workouts, PRs, custom exercise, template, body stats,
-- photos, nutrition, water, AI, social, admin history.
-- ---------------------------------------------------------------------------
insert into public.exercises (id, slug, name, primary_muscle, equipment, type, owner_id)
select 'fbfb3333-0000-0000-0000-000000000001', null, 'Gone curl', primary_muscle, equipment, type, pg_temp.u('a')
from public.exercises where slug = 'barbell_bench_press';
select pg_temp.lift('a', 'fbfb4444-0000-0000-0000-000000000001', now() - interval '2 days', pg_temp.ex('barbell_bench_press'), 80);
select pg_temp.lift('a', 'fbfb4444-0000-0000-0000-000000000002', now() - interval '1 day', pg_temp.ex('barbell_bench_press'), 90);
select pg_temp.lift('a', 'fbfb4444-0000-0000-0000-000000000003', now() - interval '3 hours', 'fbfb3333-0000-0000-0000-000000000001', 20);
select pg_temp.lift('b', 'fbfb9999-0000-0000-0000-000000000009', now() - interval '3 days', pg_temp.ex('barbell_bench_press'), 85);
insert into public.templates (id, owner_id, name) values ('fbfb5555-0000-0000-0000-000000000001', pg_temp.u('a'), 'My push day');
insert into public.template_exercises (template_id, exercise_id, position, target_sets)
values ('fbfb5555-0000-0000-0000-000000000001', 'fbfb3333-0000-0000-0000-000000000001', 0, 3);
update public.workouts set template_id = 'fbfb5555-0000-0000-0000-000000000001' where id = 'fbfb4444-0000-0000-0000-000000000003';
insert into public.user_exercise_settings (user_id, exercise_id, rest_seconds) values (pg_temp.u('a'), pg_temp.ex('barbell_bench_press'), 120);
insert into public.body_measurements (user_id, measured_on, bodyweight_kg, waist_cm) values (pg_temp.u('a'), current_date, 70.5, 81.5);
insert into public.progress_photos (id, user_id, taken_on, storage_path)
values ('fbfb6666-0000-0000-0000-000000000001', pg_temp.u('a'), current_date, pg_temp.u('a') || '/front.jpg');
insert into storage.objects (bucket_id, name) values ('progress-photos', pg_temp.u('a') || '/front.jpg'),
  ('avatars', pg_temp.u('a') || '/avatar.jpg'), ('avatars', pg_temp.u('b') || '/avatar.jpg');
update public.profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/avatars/' || pg_temp.u('a') || '/avatar.jpg'
where id = pg_temp.u('a');
select pg_temp.login(pg_temp.u('a'));
create temp table own_food as select (public.save_my_food(null, '{"name": "Gone lasagne", "kcal_100g": 160, "protein_100g": 9}')).id;
select public.save_food_log(jsonb_build_object('id', gen_random_uuid(), 'day', current_date, 'meal', 'dinner',
  'food_id', (select id from own_food), 'name', 'Gone lasagne', 'grams', 300, 'kcal', 480, 'protein', 27, 'carbs', 40, 'fat', 20,
  'client_updated_at', now()));
select public.save_water_log(gen_random_uuid(), current_date, 500);
select public.set_food_favorite((select id from own_food), true);
select public.delete_workout('fbfb4444-0000-0000-0000-000000000001');
select pg_temp.logout();
insert into public.nutrition_targets (user_id, kcal, protein_g, carbs_g, fat_g, water_ml, method)
values (pg_temp.u('a'), 2600, 150, 300, 80, 2500, 'manual');
insert into public.user_programs (id, user_id, name, weeks, source) values ('fbfb7777-0000-0000-0000-000000000001', pg_temp.u('a'), 'Gone plan', 4, 'ai');
insert into public.coach_messages (user_id, role, content) values (pg_temp.u('a'), 'user', 'How is my bench?');
insert into public.ai_feedback (user_id, kind, week_start, content, model)
values (pg_temp.u('a'), 'weekly', date_trunc('week', now())::date, '{"summary": "ok"}', 'test');
insert into public.photo_locks (user_id, kind, secret_hash) values (pg_temp.u('a'), 'pin', 'x') on conflict do nothing;
insert into public.push_tokens (token, user_id) values ('ExponentPushToken[gone]', pg_temp.u('a'));
insert into public.privacy_settings (user_id, activity_visibility) values (pg_temp.u('a'), 'friends') on conflict do nothing;
insert into public.scheduled_pushes (user_id, tag, send_at, title, body) values (pg_temp.u('a'), 'rest2', now() + interval '1 minute', 't', 'b');

-- Social: friends with bea (she gets the inbox entries), reactions, a friend
-- challenge, reports both ways, a block on someone else.
create temp table acts as select user_id, min(id::text)::uuid as id from public.activity group by user_id;
grant select on acts to authenticated;
select pg_temp.login(pg_temp.u('a'));
select public.send_friend_request(pg_temp.u('b'));
select pg_temp.login(pg_temp.u('b'));
select public.respond_friend_request(pg_temp.u('a'), true);
select pg_temp.login(pg_temp.u('a'));
select public.react((select id from acts where user_id = pg_temp.u('b')), '💪');
create temp table fc as select public.create_friend_challenge(jsonb_build_object('title', 'Gone bench-off', 'metric', 'workouts',
  'goal', 5, 'start_date', current_date, 'end_date', current_date + 7), array[pg_temp.u('b')]) as c;
select public.report_user(pg_temp.u('b'), 'spam', 'zz_gone_user reporting');
select public.block_user(pg_temp.u('c'));
select pg_temp.login(pg_temp.u('b'));
select public.react((select id from acts where user_id = pg_temp.u('a')), '💪');
select public.report_user(pg_temp.u('a'), 'other', 'about zz_gone_user');
select pg_temp.logout();
select pg_temp.check((select count(*) >= 2 from public.notifications where user_id = pg_temp.u('b')
                      and (ref = pg_temp.u('a')::text or body like 'zz_gone_user %')), 'bea has inbox entries about the user');
-- Admin history about (and by) the user.
select pg_temp.login(pg_temp.u('c'));
select public.admin_set_ai_override(pg_temp.u('a'), 12, 'coach');
select public.admin_set_user_banned(pg_temp.u('a'), false, 'checked zz_gone_user');
select pg_temp.logout();
update public.profiles set role = 'admin' where id = pg_temp.u('a');
select pg_temp.login(pg_temp.u('a'));
select public.admin_set_user_banned(pg_temp.u('b'), false, 'looked at bea');
select pg_temp.logout();
update public.profiles set role = 'user' where id = pg_temp.u('a');
select pg_temp.check((select count(*) >= 3 from public.admin_actions where admin_id = pg_temp.u('a') or target_id = pg_temp.u('a')::text),
  'admin log mentions the user');

-- ---------------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------------
create temp table dump as select public.export_user_data(pg_temp.u('a')) as d;
select pg_temp.check((select d -> 'profile' ->> 'username' = 'zz_gone_user' from dump), 'export: profile');
select pg_temp.check((select jsonb_array_length(d -> 'workouts') = 2 and jsonb_array_length(d -> 'sets') = 6 from dump),
  'export: workouts and sets (deleted ones not included)');
select pg_temp.check((select d -> 'sets' @> '[{"exercise": "Gone curl", "weight_kg": 20}]' from dump), 'sets carry exercise names');
select pg_temp.check((select jsonb_array_length(d -> 'templates') = 1 and d -> 'templates' -> 0 -> 'exercises' -> 0 ->> 'exercise' = 'Gone curl' from dump),
  'export: templates with exercises');
select pg_temp.check((select jsonb_array_length(d -> 'personal_records') >= 1 from dump), 'export: PRs');
select pg_temp.check((select d -> 'body_stats' -> 0 ->> 'waist_cm' = '81.5' from dump), 'export: body stats');
select pg_temp.check((select (d -> 'food_logs' -> 0 ->> 'kcal')::numeric = 480 and (d -> 'water' -> 0 ->> 'ml')::numeric = 500
                      and (d -> 'nutrition_targets' ->> 'kcal')::numeric = 2600 from dump), 'export: nutrition and water');
select pg_temp.check((select jsonb_array_length(d -> 'points') >= 1 and jsonb_array_length(d -> 'badges') >= 1 from dump),
  'export: points history and badges');
select pg_temp.check((select d -> 'friends' -> 0 ->> 'username' = 'bea_stays' from dump), 'export: friends by username');
select pg_temp.check((select d -> 'progress_photos' -> 0 ->> 'storage_path' like '%/front.jpg' from dump), 'export: photo list');
select pg_temp.check((select not (d::text like '%stays@test.dev%') and not (d::text like '%gone@test.dev%') from dump), 'no emails in exports');
select pg_temp.check((select not (d::text like '%' || pg_temp.u('b') || '%') from dump), 'no other user ids');
select public.export_user_data(pg_temp.u('a')) from generate_series(1, 4);
select pg_temp.expect_error($$select public.export_user_data('fbfb0000-0000-0000-0000-00000000000a')$$, 'export: 5 an hour');
select pg_temp.login(pg_temp.u('a'));
select pg_temp.expect_error($$select public.export_user_data('fbfb0000-0000-0000-0000-00000000000a')$$, 'export only through the function');
select pg_temp.expect_error($$select public.delete_user_data('fbfb0000-0000-0000-0000-00000000000a')$$, 'clients can''t delete accounts');
select pg_temp.logout();

-- ---------------------------------------------------------------------------
-- Delete account
-- ---------------------------------------------------------------------------
select pg_temp.check((select (public.account_for_delete(pg_temp.u('c')) ->> 'last_admin')::boolean), 'boss is the last admin');
select pg_temp.expect_error($$select public.delete_user_data('fbfb0000-0000-0000-0000-00000000000c')$$, 'the last admin can''t be deleted');
select pg_temp.check((select exists (select 1 from public.profiles where id = pg_temp.u('c'))), 'and is still there');
select pg_temp.expect_error($$select public.delete_user_data('fbfb0000-0000-0000-0000-00000000000a')$$, 'storage files must go first');
-- (The Edge Function removes the files through the Storage API.)
delete from storage.objects where (storage.foldername(name))[1] = pg_temp.u('a')::text;

create temp table bea_before as
select (select count(*) from public.workouts where user_id = pg_temp.u('b')) as workouts,
       (select count(*) from public.workout_sets where user_id = pg_temp.u('b')) as sets,
       (select count(*) from public.notifications where user_id = pg_temp.u('b')
          and not (ref = pg_temp.u('a')::text or body like 'zz_gone_user %' or data ->> 'url' = '/users/zz_gone_user')) as notes;
create temp table result as select public.delete_user_data(pg_temp.u('a')) as r;
select pg_temp.check((select r ->> 'label' ~ '^deleted-user-[0-9a-f]{8}$' from result), 'returns the anonymous label');
delete from auth.users where id = pg_temp.u('a');

-- Every column of every table and view (public, auth, storage): no id,
-- username or email of the deleted user anywhere.
create function pg_temp.traces() returns text language plpgsql as $$
declare
  r record;
  hits bigint;
  found text := '';
begin
  for r in
    select n.nspname, c.relname, a.attname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'm', 'v')
      and format_type(a.atttypid, a.atttypmod) in ('uuid', 'text', 'jsonb', 'json', 'character varying', 'uuid[]', 'text[]')
  loop
    execute format($q$select count(*) from %I.%I where %I::text ilike '%%fbfb0000-0000-0000-0000-00000000000a%%'
                      or %I::text ilike '%%zz_gone_user%%' or %I::text ilike '%%gone@test.dev%%'
                      or %I::text ilike '%%fbfb3333-0000-0000-0000-000000000001%%' or %I::text ilike '%%fbfb4444-0000-0000-0000-00000000000%%'
                      or %I::text ilike '%%Gone lasagne%%' or %I::text ilike '%%Gone bench-off%%'$q$,
                   r.nspname, r.relname, r.attname, r.attname, r.attname, r.attname, r.attname, r.attname, r.attname)
      into hits;
    if hits > 0 then found := found || format(' %s.%s.%s(%s)', r.nspname, r.relname, r.attname, hits); end if;
  end loop;
  return found;
end $$;
create temp table leftover as select pg_temp.traces() as t;
select pg_temp.check((select t = '' from leftover), 'nothing of the user is left anywhere' || coalesce((select ' →' || t from leftover where t <> ''), ''));

select pg_temp.check((select count(*) = 0 from storage.objects where name like pg_temp.u('a') || '/%'), 'no files left');
select pg_temp.check((select count(*) = 1 from storage.objects where name like pg_temp.u('b') || '/%'), 'others'' files stay');
select pg_temp.check((select workouts = (select count(*) from public.workouts where user_id = pg_temp.u('b'))
                         and sets = (select count(*) from public.workout_sets where user_id = pg_temp.u('b'))
                         and notes = (select count(*) from public.notifications where user_id = pg_temp.u('b')) from bea_before),
  'others'' workouts and unrelated notifications stay');
select pg_temp.check((select count(*) = 0 from public.friendships), 'friendship gone');
select pg_temp.check((select count(*) = 0 from public.challenges where title = 'Gone bench-off'), 'their friend challenge is gone');
select pg_temp.check((select count(*) = 0 from public.challenge_participants where user_id = pg_temp.u('b')
                      and challenge_id = (select c from fc)), 'with its entries');
select pg_temp.check((select count(*) = 0 from public.activity_reactions), 'reactions gone (theirs and on their items)');
select pg_temp.check((select count(*) = 0 from public.user_reports), 'reports by and about them gone');
select pg_temp.check((select count(*) >= 4 from public.admin_actions a, result
                      where a.target_id = r ->> 'label' or a.details ->> 'admin' = r ->> 'label'),
  'admin log keeps the entries, anonymised');
select pg_temp.check((select exists (select 1 from public.admin_actions a, result where a.action = 'user.deleted' and a.target_id = r ->> 'label')),
  'the deletion itself is logged');
select pg_temp.check((select count(*) = 1 from public.admin_actions where details ->> 'note' = 'looked at bea' and admin_id is null),
  'actions they took as admin stay, without them');
select pg_temp.check((select exists (select 1 from public.profiles where id = pg_temp.u('b'))
                      and exists (select 1 from public.profiles where id = pg_temp.u('c'))), 'other accounts untouched');
select pg_temp.expect_error($$select public.delete_user_data('fbfb0000-0000-0000-0000-00000000000a')$$, 'deleting twice fails cleanly');

-- With a second admin, an admin can be deleted.
select pg_temp.new_user(pg_temp.u('d'), 'second@test.dev');
update public.profiles set username = 'second_admin', role = 'admin' where id = pg_temp.u('d');
select pg_temp.check((select not (public.account_for_delete(pg_temp.u('c')) ->> 'last_admin')::boolean), 'two admins');
select public.delete_user_data(pg_temp.u('c'));
select pg_temp.check((select (public.account_for_delete(pg_temp.u('d')) ->> 'last_admin')::boolean), 'now the other one is the last');

rollback;
\echo 'web app tests passed'
