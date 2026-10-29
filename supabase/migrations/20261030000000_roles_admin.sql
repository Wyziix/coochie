-- Stage 1 additions: user/admin roles, JWT role claim, admin action log.

create type public.app_role as enum ('user', 'admin');

alter table public.profiles
  add column role public.app_role not null default 'user';

-- Server-side admin check used by policies and admin functions. Reads the
-- profiles table (not the JWT) so a demoted admin loses access immediately,
-- not when their token expires.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Current role of the signed-in user, for the RLS check below.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

revoke execute on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

-- Users can't set or change their role. Only SQL (postgres) or the service
-- key (service_role, bypasses RLS) can.
drop policy "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id and role = 'user');

drop policy "profiles: update own" on public.profiles;
create policy "profiles: update own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = (select public.current_app_role()));

-- Second line of defence in case a future policy is too loose.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and current_user in ('authenticated', 'anon') then
    raise exception 'role can only be changed by an administrator via SQL'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- Custom access token hook: adds "user_role" to every JWT. Enable it in the
-- dashboard (Authentication > Hooks). The app reads it for UI only; policies
-- use is_admin().
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  user_role public.app_role;
begin
  select role into user_role from public.profiles where id = (event ->> 'user_id')::uuid;
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(user_role, 'user')::text));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant select on table public.profiles to supabase_auth_admin;

create policy "profiles: auth server reads roles"
on public.profiles for select
to supabase_auth_admin
using (true);

-- Log of every admin action. Written only by admin functions (security
-- definer), never directly by clients.
create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_actions_created_at_idx on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;

create policy "admin_actions: admins read"
on public.admin_actions for select
to authenticated
using ((select public.is_admin()));

-- No insert/update/delete policies: clients can't write the log.

-- Called at the start of every admin function. Raises unless the caller is an
-- admin, then records the action.
create or replace function public.log_admin_action(
  action text,
  target_type text default null,
  target_id text default null,
  details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.admin_actions (admin_id, action, target_type, target_id, details)
  values ((select auth.uid()), action, target_type, target_id, coalesce(details, '{}'::jsonb));
end;
$$;

-- Internal helper: only other security definer functions (owned by postgres) call it.
revoke execute on function public.log_admin_action(text, text, text, jsonb) from public, anon, authenticated;

-- First admin.
update public.profiles p
set role = 'admin'
from auth.users u
where u.id = p.id and lower(u.email) = 'kopenkin.ne@gmail.com';
