-- Photo lock: without an unlock token from the right PIN/password nobody can
-- list, view or download progress photos, their own included.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('aaaa0000-0000-0000-0000-000000000001', 'lock@test.dev');
select pg_temp.new_user('aaaa0000-0000-0000-0000-000000000002', 'lock-other@test.dev');

-- One photo each, as the Edge Function (service role) would have stored them.
insert into public.progress_photos (id, user_id, storage_path) values
  ('bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000001/bbbb0000-0000-0000-0000-000000000001.jpg'),
  ('bbbb0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000002',
   'aaaa0000-0000-0000-0000-000000000002/bbbb0000-0000-0000-0000-000000000002.jpg');
insert into storage.objects (bucket_id, name) values
  ('progress-photos', 'aaaa0000-0000-0000-0000-000000000001/bbbb0000-0000-0000-0000-000000000001.jpg'),
  ('progress-photos', 'aaaa0000-0000-0000-0000-000000000002/bbbb0000-0000-0000-0000-000000000002.jpg');

-- Logs in with an amr claim, like a real access token.
create function pg_temp.login_amr(uid uuid, method text, seconds_ago integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', method, 'timestamp', extract(epoch from now())::bigint - seconds_ago))
  )::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.login('aaaa0000-0000-0000-0000-000000000001');

-- Nothing is reachable directly, not even your own photos.
select pg_temp.expect_error($$select * from public.progress_photos$$, 'cannot list own photo rows directly');
select pg_temp.check((select count(*) = 0 from storage.objects where bucket_id = 'progress-photos'),
  'cannot see any photo file (own or other) in storage, so no signed URL or download');
select pg_temp.expect_error($$insert into storage.objects (bucket_id, name) values ('progress-photos', 'aaaa0000-0000-0000-0000-000000000001/x.jpg')$$,
  'cannot upload into own folder directly');
with d as (delete from storage.objects where bucket_id = 'progress-photos' returning 1)
select pg_temp.check((select count(*) = 0 from d), 'cannot delete photo files directly');
select pg_temp.expect_error($$select * from public.photo_locks$$, 'cannot read lock rows (PIN hashes)');
select pg_temp.expect_error($$select * from public.photo_unlocks$$, 'cannot read unlock sessions');
select pg_temp.expect_error($$select * from public.photo_devices$$, 'cannot read device keys');
select pg_temp.expect_error($$select public._photo_check('1234', null)$$, 'cannot call internal helpers');

-- Not set up yet.
select pg_temp.check((select public.photo_lock_status() ->> 'state' = 'setup'), 'starts as "setup"');
select pg_temp.check((select (public.photo_lock_status() ->> 'photo_count')::int = 1), 'status shows only the photo count');
select pg_temp.check((select public.photo_unlock('1234') ->> 'reason' = 'setup'), 'unlock before setup asks to set up');
select pg_temp.expect_error($$select * from public.photo_list(null)$$, 'no token: cannot list photos');
select pg_temp.expect_error($$select * from public.photo_list('made-up')$$, 'made-up token: cannot list photos');

-- Setup.
select pg_temp.expect_error($$select public.photo_setup('pin', '12')$$, 'PIN shorter than 4 rejected');
select pg_temp.expect_error($$select public.photo_setup('pin', '1234567')$$, 'PIN longer than 6 rejected');
select pg_temp.expect_error($$select public.photo_setup('pin', '12ab')$$, 'PIN must be digits');
select pg_temp.expect_error($$select public.photo_setup('password', 'abc')$$, 'password shorter than 6 rejected');
select pg_temp.expect_error($$select public.photo_setup('face', 'x')$$, 'unknown kind rejected');
select public.photo_setup('pin', '2580') ->> 'token' as tok_a \gset
select pg_temp.check(length(:'tok_a') = 64, 'setup returns an unlock token');
select pg_temp.expect_error($$select public.photo_setup('pin', '1111')$$, 'cannot set up again over an existing PIN');

select pg_temp.logout();
select pg_temp.check((select secret_hash like '$2a$10$%' and secret_hash not like '%2580%' from public.photo_locks
  where user_id = 'aaaa0000-0000-0000-0000-000000000001'), 'PIN stored as a bcrypt hash, not in plain text');
select pg_temp.check((select token_hash <> convert_to(:'tok_a', 'UTF8') from public.photo_unlocks
  where user_id = 'aaaa0000-0000-0000-0000-000000000001'), 'unlock token stored only as a hash');
select pg_temp.login('aaaa0000-0000-0000-0000-000000000001');

-- Unlocked: own photos only.
select pg_temp.check((select count(*) = 1 and bool_and(user_id = 'aaaa0000-0000-0000-0000-000000000001')
  from public.photo_list(:'tok_a')), 'with the token: lists own photos only');
select pg_temp.check((select public.photo_session(:'tok_a') ->> 'user_id' = 'aaaa0000-0000-0000-0000-000000000001'),
  'photo_session confirms the token''s owner');
select pg_temp.check((select public.photo_add(:'tok_a', 'bbbb0000-0000-0000-0000-000000000003', '2026-10-01', 'side', 1200, 1600)
  = 'aaaa0000-0000-0000-0000-000000000001/bbbb0000-0000-0000-0000-000000000003.jpg'), 'adding a photo puts it in own folder');
select pg_temp.expect_error(format('select public.photo_add(%L, gen_random_uuid(), null, %L, 1, 1)', :'tok_a', 'selfie'),
  'unknown pose rejected');
select pg_temp.expect_error(format('select public.photo_delete(%L, %L)', :'tok_a', 'bbbb0000-0000-0000-0000-000000000002'),
  'cannot delete another user''s photo, even unlocked');
select public.photo_relock(:'tok_a');
select pg_temp.expect_error(format('select * from public.photo_list(%L)', :'tok_a'), 'after re-locking the token is dead');
select pg_temp.expect_error(format('select public.photo_add(%L, gen_random_uuid(), null, null, 1, 1)', :'tok_a'),
  'and cannot add photos');
select pg_temp.expect_error(format('select public.photo_delete(%L, %L)', :'tok_a', 'bbbb0000-0000-0000-0000-000000000003'),
  'or delete them');

-- Wrong attempts: 5 in a row lock it for 15 minutes, enforced here.
select pg_temp.check((select public.photo_unlock('0000') = '{"ok": false, "reason": "wrong", "attempts_left": 4}'::jsonb), 'wrong PIN: 4 left');
select public.photo_unlock('0000');
select public.photo_unlock('0000');
select pg_temp.check((select public.photo_unlock('0000') ->> 'attempts_left' = '1'), '4th wrong: 1 left');
select pg_temp.check((select public.photo_unlock('0000') ->> 'reason' = 'locked'), '5th wrong: locked');
select pg_temp.check((select public.photo_unlock('2580') ->> 'reason' = 'locked'), 'while locked even the right PIN is refused');
select pg_temp.check((select (public.photo_lock_status() ->> 'locked_until')::timestamptz between now() + interval '14 minutes' and now() + interval '15 minutes'),
  'status shows when it opens again (15 minutes)');
select pg_temp.logout();
update public.photo_locks set locked_until = now() - interval '1 second' where user_id = 'aaaa0000-0000-0000-0000-000000000001';
select pg_temp.login('aaaa0000-0000-0000-0000-000000000001');
select public.photo_unlock('2580') ->> 'token' as tok_b \gset
select pg_temp.check(length(:'tok_b') = 64, 'after the 15 minutes the right PIN works');
select pg_temp.check((select public.photo_lock_status() ->> 'attempts_left' = '5'), 'and the counter is reset');

-- Tokens expire after 5 minutes.
select pg_temp.check((select (public.photo_session(:'tok_b') ->> 'expires_at')::timestamptz = now() + interval '5 minutes'), 'unlock lasts 5 minutes');
select pg_temp.logout();
update public.photo_unlocks set expires_at = now() - interval '1 second'
where token_hash = extensions.digest(:'tok_b', 'sha256');
select pg_temp.login('aaaa0000-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('select * from public.photo_list(%L)', :'tok_b'), 'expired token cannot list photos');

-- Another user can't use your token.
select public.photo_unlock('2580') ->> 'token' as tok_c \gset
select pg_temp.login('aaaa0000-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select * from public.photo_list(%L)', :'tok_c'), 'another user cannot use your unlock token');
select pg_temp.expect_error(format('select public.photo_delete(%L, %L)', :'tok_c', 'bbbb0000-0000-0000-0000-000000000001'),
  'or delete your photos with it');
select pg_temp.check((select public.photo_lock_status() ->> 'state' = 'setup'), 'other user''s lock is separate');
select pg_temp.login('aaaa0000-0000-0000-0000-000000000001');

-- Biometrics device key.
select public.photo_register_device(:'tok_c', 'Pixel') as dev \gset
select pg_temp.check((select public.photo_unlock(null, (:'dev'::jsonb) ->> 'key') ->> 'ok' = 'true'), 'device key unlocks');
select pg_temp.check((select public.photo_unlock(null, 'not-the-key') ->> 'reason' = 'wrong'), 'wrong device key counts as a wrong attempt');
select pg_temp.expect_error($$select public.photo_register_device('made-up', 'x')$$, 'registering a device needs an unlock');

-- Change: needs the current PIN, ends unlock sessions.
select pg_temp.check((select public.photo_change_secret('9999', 'password', 'hunter22') ->> 'reason' = 'wrong'), 'change with wrong current PIN refused');
select pg_temp.check((select public.photo_change_secret('2580', 'password', 'hunter22') ->> 'ok' = 'true'), 'change to a password');
select pg_temp.expect_error(format('select * from public.photo_list(%L)', :'tok_c'), 'changing ends existing unlocks');
select pg_temp.check((select public.photo_unlock('2580') ->> 'reason' = 'wrong'), 'old PIN no longer works');
select pg_temp.check((select public.photo_unlock('hunter22') ->> 'ok' = 'true'), 'new password works');
select pg_temp.check((select public.photo_lock_status() ->> 'state' = 'password'), 'status says password');

select public.photo_forget_device(((:'dev'::jsonb) ->> 'id')::uuid);
select pg_temp.check((select public.photo_unlock(null, (:'dev'::jsonb) ->> 'key') ->> 'reason' = 'wrong'), 'forgotten device key stops working');

-- Remove the lock: needs the password; then no secret is needed.
select pg_temp.check((select public.photo_remove_secret('nope!!') ->> 'reason' = 'wrong'), 'remove with wrong password refused');
select pg_temp.check((select public.photo_remove_secret('hunter22') ->> 'ok' = 'true'), 'remove with the password');
select pg_temp.check((select public.photo_lock_status() ->> 'state' = 'none'), 'state is "none"');
select pg_temp.check((select length(public.photo_unlock() ->> 'token') = 64), 'without a lock, unlocking needs no secret');
select pg_temp.check((select length(public.photo_setup('pin', '1357') ->> 'token') = 64), 'a new PIN can be set again later');

-- Forgot PIN: only right after a Google sign-in.
select pg_temp.expect_error($$select public.photo_reset_lock()$$, 'reset refused without a fresh login');
select pg_temp.login_amr('aaaa0000-0000-0000-0000-000000000001', 'otp', 5);
select pg_temp.expect_error($$select public.photo_reset_lock()$$, 'reset refused after an email-code login');
select pg_temp.login_amr('aaaa0000-0000-0000-0000-000000000001', 'magiclink', 5);
select pg_temp.expect_error($$select public.photo_reset_lock()$$, 'reset refused after a magic-link login');
select pg_temp.login_amr('aaaa0000-0000-0000-0000-000000000001', 'oauth', 20 * 60);
select pg_temp.expect_error($$select public.photo_reset_lock()$$, 'reset refused when the Google login is 20 minutes old');
select pg_temp.login_amr('aaaa0000-0000-0000-0000-000000000001', 'oauth', 30);
select public.photo_reset_lock();
select pg_temp.check((select public.photo_lock_status() ->> 'state' = 'setup'), 'fresh Google login resets the lock to "setup"');
select pg_temp.check((select public.photo_unlock('1357') ->> 'reason' = 'setup'), 'old PIN is gone');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.progress_photos where user_id = 'aaaa0000-0000-0000-0000-000000000001'),
  'reset keeps the photos');
select pg_temp.check((select count(*) = 0 from public.photo_unlocks where user_id = 'aaaa0000-0000-0000-0000-000000000001')
  and (select count(*) = 0 from public.photo_devices where user_id = 'aaaa0000-0000-0000-0000-000000000001'),
  'reset ends unlocks and drops device keys');
select pg_temp.check((select count(*) = 1 from public.progress_photos where user_id = 'aaaa0000-0000-0000-0000-000000000002'),
  'the other user''s photo is untouched');

-- Signed-out visitors can't call any of it.
set local role anon;
select pg_temp.expect_error($$select public.photo_unlock('1234')$$, 'anon cannot try PINs');
select pg_temp.expect_error($$select * from public.photo_list('x')$$, 'anon cannot list photos');
reset role;

rollback;
\echo 'photo lock tests passed'
