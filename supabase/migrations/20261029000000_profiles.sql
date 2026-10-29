-- Stage 1: profiles + avatars bucket.

-- Shared trigger function: keeps updated_at current. Reused by later tables
-- (sync in Stage 5 uses updated_at for last-write-wins).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type public.weight_unit as enum ('kg', 'lbs');
create type public.training_goal as enum ('strength', 'hypertrophy', 'fat_loss', 'general_fitness');
create type public.experience_level as enum ('beginner', 'intermediate', 'advanced');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  units public.weight_unit not null default 'kg',
  goal public.training_goal,
  experience_level public.experience_level,
  training_days_per_week smallint,
  bodyweight_kg numeric(5, 2),
  height_cm numeric(4, 1),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check (char_length(display_name) <= 50),
  constraint profiles_training_days check (training_days_per_week between 1 and 7),
  constraint profiles_bodyweight_range check (bodyweight_kg between 20 and 400),
  constraint profiles_height_range check (height_cm between 100 and 250),
  -- Onboarding can only be marked done once the required answers exist.
  constraint profiles_onboarding_complete check (
    onboarding_completed_at is null
    or (
      username is not null
      and goal is not null
      and experience_level is not null
      and training_days_per_week is not null
      and bodyweight_kg is not null
    )
  )
);

comment on column public.profiles.bodyweight_kg is 'Always stored in kg; the app converts using profiles.units.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles: read own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles: insert own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profiles: update own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- No delete policy: profiles go away with the auth user (on delete cascade),
-- which the account deletion Edge Function handles in Stage 11.

-- Create an empty profile for every new auth user, prefilled from Google.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 50),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Usernames must be unique, but users can't read other profiles under RLS,
-- so availability is checked through this function. Returns only a boolean.
create or replace function public.is_username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles p
    where p.username = lower(name)
      and p.id <> (select auth.uid())
  );
$$;

revoke execute on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

-- Avatars: public-read bucket (avatars will be shown to friends later).
-- Each user can only write inside their own folder: avatars/<user id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars: read own folder"
on storage.objects for select
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: upload to own folder"
on storage.objects for insert
to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: update own folder"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own folder"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
