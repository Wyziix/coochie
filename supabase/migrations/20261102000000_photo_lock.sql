-- Photo lock: progress photos need a PIN or password (hashed with bcrypt).
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- Clients lose all direct access to photo rows and files; the `photos` Edge
-- Function lists, signs, uploads and deletes them, and only with an unlock
-- token issued by photo_unlock() after the right PIN.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables. None of them is readable by clients: only the functions below
-- (security definer) touch them.
-- ---------------------------------------------------------------------------

-- One row per user once they chose a lock. No row = not set up yet (the app
-- asks for a PIN first). kind 'none' = the user removed the lock on purpose.
create table if not exists public.photo_locks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kind text not null,
  secret_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),

  constraint photo_locks_kind check (kind in ('pin', 'password', 'none')),
  constraint photo_locks_hash check ((kind = 'none') = (secret_hash is null))
);
alter table public.photo_locks enable row level security;
revoke all on public.photo_locks from anon, authenticated;

-- Unlock sessions: only the sha256 of the token is stored; the token itself
-- lives in the app's memory and dies with it.
create table if not exists public.photo_unlocks (
  token_hash bytea primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists photo_unlocks_user_idx on public.photo_unlocks (user_id);
alter table public.photo_unlocks enable row level security;
revoke all on public.photo_unlocks from anon, authenticated;

-- Fingerprint / face unlock on Android: a random device key, kept in the
-- phone's keystore behind biometrics. Not the PIN, and revocable.
create table if not exists public.photo_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key_hash bytea not null unique,
  name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,

  constraint photo_devices_name_length check (char_length(name) <= 100)
);
create index if not exists photo_devices_user_idx on public.photo_devices (user_id);
alter table public.photo_devices enable row level security;
revoke all on public.photo_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- No more direct access to progress photos (Stage 4 allowed own rows/files).
-- ---------------------------------------------------------------------------
drop policy if exists "progress_photos: own" on public.progress_photos;
revoke all on public.progress_photos from anon, authenticated;

drop policy if exists "progress-photos: read own folder" on storage.objects;
drop policy if exists "progress-photos: upload to own folder" on storage.objects;
drop policy if exists "progress-photos: update own folder" on storage.objects;
drop policy if exists "progress-photos: delete own folder" on storage.objects;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients).
-- ---------------------------------------------------------------------------
create or replace function public._photo_token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$ select extensions.digest(coalesce(p_token, ''), 'sha256') $$;

create or replace function public._photo_validate(p_kind text, p_secret text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_kind = 'pin' then
    if p_secret is null or p_secret !~ '^[0-9]{4,6}$' then
      raise exception 'PIN must be 4 to 6 digits' using errcode = '22023';
    end if;
  elsif p_kind = 'password' then
    if p_secret is null or char_length(p_secret) < 6 or octet_length(p_secret) > 72 then
      raise exception 'Password must be 6 to 72 characters' using errcode = '22023';
    end if;
  else
    raise exception 'Choose a PIN or a password' using errcode = '22023';
  end if;
end $$;

create or replace function public._photo_issue_token(p_user uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz := now() + interval '5 minutes';
begin
  delete from public.photo_unlocks where user_id = p_user and expires_at <= now();
  insert into public.photo_unlocks (token_hash, user_id, expires_at)
  values (public._photo_token_hash(v_token), p_user, v_expires);
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires);
end $$;

-- Checks a PIN/password or device key for the current user and counts wrong
-- attempts: 5 wrong in a row lock it for 15 minutes. Returns a result instead
-- of raising, so the attempt counter isn't rolled back.
create or replace function public._photo_check(p_secret text, p_device_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_lock public.photo_locks;
  v_ok boolean;
  v_failed integer;
begin
  select * into v_lock from public.photo_locks where user_id = v_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'setup');
  end if;
  if v_lock.kind = 'none' then
    return jsonb_build_object('ok', true);
  end if;
  if v_lock.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_lock.locked_until);
  end if;

  if p_device_key is not null then
    update public.photo_devices set last_used_at = now()
    where user_id = v_user and key_hash = public._photo_token_hash(p_device_key);
    v_ok := found;
  else
    v_ok := p_secret is not null and v_lock.secret_hash = extensions.crypt(p_secret, v_lock.secret_hash);
  end if;

  if v_ok then
    update public.photo_locks set failed_attempts = 0, locked_until = null where user_id = v_user;
    return jsonb_build_object('ok', true);
  end if;

  v_failed := v_lock.failed_attempts + 1;
  if v_failed >= 5 then
    update public.photo_locks
    set failed_attempts = 0, locked_until = now() + interval '15 minutes'
    where user_id = v_user
    returning locked_until into v_lock.locked_until;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_lock.locked_until);
  end if;
  update public.photo_locks set failed_attempts = v_failed where user_id = v_user;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - v_failed);
end $$;

-- The user id behind a valid, unexpired unlock token of the current user.
-- Raises with SQLSTATE PT403, which PostgREST returns as HTTP 403.
create or replace function public._photo_require(p_token text)
returns public.photo_unlocks
language plpgsql
set search_path = ''
as $$
declare
  v_row public.photo_unlocks;
begin
  select * into v_row from public.photo_unlocks
  where token_hash = public._photo_token_hash(p_token)
    and user_id = auth.uid()
    and expires_at > now();
  if not found or auth.uid() is null then
    raise exception 'Photos are locked' using errcode = 'PT403';
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Lock management (called by the app).
-- ---------------------------------------------------------------------------

-- state: 'setup' (never set), 'pin', 'password' or 'none'.
create or replace function public.photo_lock_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', coalesce(l.kind, 'setup'),
    'locked_until', case when l.locked_until > now() then l.locked_until end,
    'attempts_left', case when l.kind in ('pin', 'password') then 5 - l.failed_attempts end,
    'photo_count', (select count(*) from public.progress_photos p where p.user_id = auth.uid()),
    'devices', (select count(*) from public.photo_devices d where d.user_id = auth.uid())
  )
  from (select auth.uid() as uid) u
  left join public.photo_locks l on l.user_id = u.uid
$$;

-- First PIN/password (or a new one after removing the lock or a reset).
-- Returns an unlock token so the user goes straight in.
create or replace function public.photo_setup(p_kind text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._photo_validate(p_kind, p_secret);
  if exists (select 1 from public.photo_locks where user_id = v_user and kind <> 'none') then
    raise exception 'A photo lock is already set. Change it in Settings.' using errcode = '22023';
  end if;
  insert into public.photo_locks (user_id, kind, secret_hash)
  values (v_user, p_kind, extensions.crypt(p_secret, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do update
    set kind = excluded.kind, secret_hash = excluded.secret_hash,
        failed_attempts = 0, locked_until = null, updated_at = now();
  return public._photo_issue_token(v_user);
end $$;

-- Unlock with the PIN/password, or with a device key (Android biometrics).
-- Returns {ok, token, expires_at} or {ok: false, reason: wrong|locked|setup}.
create or replace function public.photo_unlock(p_secret text default null, p_device_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  v_check := public._photo_check(p_secret, p_device_key);
  if not (v_check ->> 'ok')::boolean then
    return v_check;
  end if;
  return public._photo_issue_token(auth.uid());
end $$;

-- Ends one unlock session (leaving the photos, app in background).
create or replace function public.photo_relock(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.photo_unlocks
  where user_id = auth.uid()
    and (token_hash = public._photo_token_hash(p_token) or expires_at <= now())
$$;

-- Change the PIN/password (needs the current one; wrong ones count as attempts).
-- Ends all unlock sessions; device keys stay.
create or replace function public.photo_change_secret(p_current text, p_kind text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_check jsonb;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public._photo_validate(p_kind, p_secret);
  if not exists (select 1 from public.photo_locks where user_id = v_user and kind <> 'none') then
    raise exception 'No photo lock is set' using errcode = '22023';
  end if;
  v_check := public._photo_check(p_current, null);
  if not (v_check ->> 'ok')::boolean then
    return v_check;
  end if;
  update public.photo_locks
  set kind = p_kind, secret_hash = extensions.crypt(p_secret, extensions.gen_salt('bf', 10)), updated_at = now()
  where user_id = v_user;
  delete from public.photo_unlocks where user_id = v_user;
  return jsonb_build_object('ok', true);
end $$;

-- Remove the lock (needs the current PIN/password). Device keys are dropped.
create or replace function public.photo_remove_secret(p_current text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_check jsonb;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.photo_locks where user_id = v_user and kind <> 'none') then
    raise exception 'No photo lock is set' using errcode = '22023';
  end if;
  v_check := public._photo_check(p_current, null);
  if not (v_check ->> 'ok')::boolean then
    return v_check;
  end if;
  update public.photo_locks
  set kind = 'none', secret_hash = null, updated_at = now()
  where user_id = v_user;
  delete from public.photo_devices where user_id = v_user;
  return jsonb_build_object('ok', true);
end $$;

-- Forgot PIN: allowed only right after a Google sign-in (the access token's
-- amr claim says 'oauth' within the last 10 minutes). Email codes and old
-- sessions don't count. The lock goes back to "not set up"; photos are kept.
create or replace function public.photo_reset_lock()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) a
    where jsonb_typeof(a) = 'object'
      and a ->> 'method' = 'oauth'
      and (a ->> 'timestamp')::numeric >= extract(epoch from now()) - 600
  ) then
    raise exception 'Sign in with Google again to reset the photo lock' using errcode = 'PT401';
  end if;
  delete from public.photo_unlocks where user_id = v_user;
  delete from public.photo_devices where user_id = v_user;
  delete from public.photo_locks where user_id = v_user;
end $$;

-- Android biometrics: registers this phone while unlocked. Returns the key
-- once; only its hash is stored. Keeps at most 5 devices per user.
create or replace function public.photo_register_device(p_token text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (public._photo_require(p_token)).user_id;
  v_key text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  if not exists (select 1 from public.photo_locks where user_id = v_user and kind <> 'none') then
    raise exception 'Set a PIN or password first' using errcode = '22023';
  end if;
  insert into public.photo_devices (user_id, key_hash, name)
  values (v_user, public._photo_token_hash(v_key), left(p_name, 100))
  returning id into v_id;
  delete from public.photo_devices
  where id in (
    select id from public.photo_devices where user_id = v_user
    order by created_at desc offset 5
  );
  return jsonb_build_object('id', v_id, 'key', v_key);
end $$;

create or replace function public.photo_forget_device(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ delete from public.photo_devices where id = p_id and user_id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- Photo access, each call needs a valid unlock token. Called by the `photos`
-- Edge Function with the user's own JWT; it signs URLs / stores files only
-- after these succeed.
-- ---------------------------------------------------------------------------
create or replace function public.photo_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.photo_unlocks := public._photo_require(p_token);
begin
  return jsonb_build_object('user_id', v_row.user_id, 'expires_at', v_row.expires_at);
end $$;

create or replace function public.photo_list(p_token text)
returns setof public.progress_photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (public._photo_require(p_token)).user_id;
begin
  return query
    select * from public.progress_photos
    where user_id = v_user
    order by taken_on desc, created_at desc;
end $$;

-- Records an uploaded photo; returns its storage path (<user id>/<id>.jpg).
create or replace function public.photo_add(
  p_token text,
  p_id uuid,
  p_taken_on date,
  p_pose text,
  p_width integer,
  p_height integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (public._photo_require(p_token)).user_id;
  v_path text := v_user::text || '/' || p_id::text || '.jpg';
begin
  insert into public.progress_photos (id, user_id, storage_path, taken_on, pose, width, height)
  values (p_id, v_user, v_path, coalesce(p_taken_on, current_date), coalesce(p_pose, 'front'), p_width, p_height);
  return v_path;
end $$;

-- Deletes the user's photo row; returns the file path for the Edge Function to remove.
create or replace function public.photo_delete(p_token text, p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (public._photo_require(p_token)).user_id;
  v_path text;
begin
  delete from public.progress_photos where id = p_id and user_id = v_user returning storage_path into v_path;
  if v_path is null then
    raise exception 'Photo not found' using errcode = 'P0002';
  end if;
  return v_path;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers are internal; the rest only for signed-in users.
-- ---------------------------------------------------------------------------
revoke all on function public._photo_token_hash(text) from public, anon, authenticated;
revoke all on function public._photo_validate(text, text) from public, anon, authenticated;
revoke all on function public._photo_issue_token(uuid) from public, anon, authenticated;
revoke all on function public._photo_check(text, text) from public, anon, authenticated;
revoke all on function public._photo_require(text) from public, anon, authenticated;

revoke all on function public.photo_lock_status() from public, anon;
revoke all on function public.photo_setup(text, text) from public, anon;
revoke all on function public.photo_unlock(text, text) from public, anon;
revoke all on function public.photo_relock(text) from public, anon;
revoke all on function public.photo_change_secret(text, text, text) from public, anon;
revoke all on function public.photo_remove_secret(text) from public, anon;
revoke all on function public.photo_reset_lock() from public, anon;
revoke all on function public.photo_register_device(text, text) from public, anon;
revoke all on function public.photo_forget_device(uuid) from public, anon;
revoke all on function public.photo_session(text) from public, anon;
revoke all on function public.photo_list(text) from public, anon;
revoke all on function public.photo_add(text, uuid, date, text, integer, integer) from public, anon;
revoke all on function public.photo_delete(text, uuid) from public, anon;

grant execute on function public.photo_lock_status() to authenticated;
grant execute on function public.photo_setup(text, text) to authenticated;
grant execute on function public.photo_unlock(text, text) to authenticated;
grant execute on function public.photo_relock(text) to authenticated;
grant execute on function public.photo_change_secret(text, text, text) to authenticated;
grant execute on function public.photo_remove_secret(text) to authenticated;
grant execute on function public.photo_reset_lock() to authenticated;
grant execute on function public.photo_register_device(text, text) to authenticated;
grant execute on function public.photo_forget_device(uuid) to authenticated;
grant execute on function public.photo_session(text) to authenticated;
grant execute on function public.photo_list(text) to authenticated;
grant execute on function public.photo_add(text, uuid, date, text, integer, integer) to authenticated;
grant execute on function public.photo_delete(text, uuid) to authenticated;
