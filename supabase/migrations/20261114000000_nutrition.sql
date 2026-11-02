-- Stage 10: nutrition tracking.
-- idempotent: safe to run again if a previous run stopped halfway.
--
-- foods: Open Food Facts results cached by the food-search Edge Function
-- (everyone can read them) plus foods users create themselves (only theirs).
-- Logs, water, favourites and targets belong to one user and are never
-- visible to anyone else: not in the feed, leaderboards, challenges or
-- profiles. Logs and water go through the offline sync queue (last write
-- wins, like workouts).

-- ---------------------------------------------------------------------------
-- Foods
-- ---------------------------------------------------------------------------
create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  barcode text,
  name text not null,
  brand text,
  kcal_100g numeric(6, 1) not null,
  protein_100g numeric(5, 1) not null default 0,
  carbs_100g numeric(5, 1) not null default 0,
  fat_100g numeric(5, 1) not null default 0,
  serving_g numeric(6, 1),
  serving_label text,
  owner_id uuid references auth.users (id) on delete cascade,
  is_hidden boolean not null default false,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foods_source check (source in ('off', 'user')),
  constraint foods_owner check ((source = 'user') = (owner_id is not null)),
  constraint foods_name check (char_length(btrim(name)) between 1 and 120),
  constraint foods_brand check (char_length(brand) <= 80),
  constraint foods_barcode check (barcode ~ '^[0-9]{6,14}$'),
  constraint foods_values check (
    kcal_100g between 0 and 900 and protein_100g between 0 and 100
    and carbs_100g between 0 and 100 and fat_100g between 0 and 100
  ),
  constraint foods_serving check (serving_g is null or serving_g > 0 and serving_g <= 2000),
  constraint foods_serving_label check (char_length(serving_label) <= 40)
);
create unique index if not exists foods_off_barcode_idx on public.foods (barcode) where source = 'off';
create index if not exists foods_owner_idx on public.foods (owner_id, barcode);
create index if not exists foods_name_idx on public.foods (lower(name));
alter table public.foods enable row level security;
revoke all on public.foods from anon, authenticated;
grant select on public.foods to authenticated;
drop policy if exists "foods: cached and own" on public.foods;
create policy "foods: cached and own" on public.foods for select to authenticated
using (
  owner_id = (select auth.uid())
  or (owner_id is null and (not is_hidden or (select public.is_admin())))
);

-- ---------------------------------------------------------------------------
-- Logs, water, favourites, targets (owner only)
-- ---------------------------------------------------------------------------
create table if not exists public.food_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  meal text not null,
  food_id uuid references public.foods (id) on delete set null,
  name text not null,
  grams numeric(6, 1),
  servings numeric(5, 2),
  kcal numeric(7, 1) not null,
  protein numeric(6, 1) not null default 0,
  carbs numeric(6, 1) not null default 0,
  fat numeric(6, 1) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz,
  constraint food_logs_meal check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  constraint food_logs_name check (char_length(btrim(name)) between 1 and 120),
  constraint food_logs_values check (
    kcal between 0 and 10000 and protein between 0 and 1000 and carbs between 0 and 1000 and fat between 0 and 1000
  ),
  constraint food_logs_portion check ((grams is null or grams between 0 and 5000) and (servings is null or servings between 0 and 100))
);
create index if not exists food_logs_user_day_idx on public.food_logs (user_id, day);

create table if not exists public.water_logs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  ml integer not null,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz,
  constraint water_logs_ml check (ml between 1 and 5000)
);
create index if not exists water_logs_user_day_idx on public.water_logs (user_id, day);

create table if not exists public.food_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  food_id uuid not null references public.foods (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, food_id)
);

create table if not exists public.nutrition_targets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kcal integer not null,
  protein_g integer not null,
  carbs_g integer not null,
  fat_g integer not null,
  water_ml integer not null default 2500,
  method text not null default 'manual',
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint nutrition_targets_values check (
    kcal between 800 and 8000 and protein_g between 0 and 500 and carbs_g between 0 and 1000
    and fat_g between 0 and 400 and water_ml between 500 and 8000
  ),
  constraint nutrition_targets_method check (method in ('manual', 'mifflin_st_jeor'))
);

do $$
declare
  t text;
begin
  foreach t in array array['food_logs', 'water_logs', 'food_favorites', 'nutrition_targets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists "%s: own" on public.%I', t, t);
    execute format('create policy "%s: own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
  end loop;
end $$;
-- Targets are edited directly (own row only); logs go through the functions below.
grant insert, update on public.nutrition_targets to authenticated;
drop policy if exists "nutrition_targets: write own" on public.nutrition_targets;
create policy "nutrition_targets: write own" on public.nutrition_targets for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "nutrition_targets: update own" on public.nutrition_targets;
create policy "nutrition_targets: update own" on public.nutrition_targets for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.foods, public.food_logs, public.water_logs, public.food_favorites,
  public.nutrition_targets to service_role;

-- Deletes made offline leave tombstones like workouts and templates.
alter table public.sync_tombstones drop constraint if exists sync_tombstones_entity;
alter table public.sync_tombstones add constraint sync_tombstones_entity
  check (entity in ('workout', 'template', 'food_log', 'water_log'));

-- ---------------------------------------------------------------------------
-- Own foods (barcode not found, or homemade)
-- p_food: {name, brand, barcode, kcal_100g, protein_100g, carbs_100g,
--          fat_100g, serving_g, serving_label}
-- ---------------------------------------------------------------------------
create or replace function public.save_my_food(p_id uuid, p_food jsonb)
returns public.foods
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result public.foods;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_id is null then
    if (select count(*) from public.foods where owner_id = uid) >= 500 then
      raise exception 'You can keep at most 500 of your own foods.' using errcode = '22023';
    end if;
    insert into public.foods (source, owner_id, barcode, name, brand, kcal_100g, protein_100g, carbs_100g, fat_100g,
                              serving_g, serving_label)
    values ('user', uid, nullif(btrim(p_food ->> 'barcode'), ''), btrim(p_food ->> 'name'), nullif(btrim(p_food ->> 'brand'), ''),
            (p_food ->> 'kcal_100g')::numeric, coalesce((p_food ->> 'protein_100g')::numeric, 0),
            coalesce((p_food ->> 'carbs_100g')::numeric, 0), coalesce((p_food ->> 'fat_100g')::numeric, 0),
            nullif(p_food ->> 'serving_g', '')::numeric, nullif(btrim(p_food ->> 'serving_label'), ''))
    returning * into result;
  else
    update public.foods set
      barcode = nullif(btrim(p_food ->> 'barcode'), ''), name = btrim(p_food ->> 'name'),
      brand = nullif(btrim(p_food ->> 'brand'), ''), kcal_100g = (p_food ->> 'kcal_100g')::numeric,
      protein_100g = coalesce((p_food ->> 'protein_100g')::numeric, 0), carbs_100g = coalesce((p_food ->> 'carbs_100g')::numeric, 0),
      fat_100g = coalesce((p_food ->> 'fat_100g')::numeric, 0), serving_g = nullif(p_food ->> 'serving_g', '')::numeric,
      serving_label = nullif(btrim(p_food ->> 'serving_label'), ''), updated_at = now()
    where id = p_id and owner_id = uid
    returning * into result;
    if result.id is null then raise exception 'food % not found', p_id using errcode = 'P0002'; end if;
  end if;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Food logs and water (also used by the offline sync queue)
-- ---------------------------------------------------------------------------

-- Values for a portion of a food: grams, or servings × serving size.
create or replace function public._portion(f public.foods, grams numeric, servings numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with g as (select coalesce(grams, servings * f.serving_g) as g)
  select jsonb_build_object(
    'grams', round(g.g, 1),
    'kcal', round(f.kcal_100g * g.g / 100, 1), 'protein', round(f.protein_100g * g.g / 100, 1),
    'carbs', round(f.carbs_100g * g.g / 100, 1), 'fat', round(f.fat_100g * g.g / 100, 1)
  )
  from g where g.g is not null
$$;

-- p_log: {id, day, meal, food_id?, name, grams?, servings?, kcal, protein,
-- carbs, fat, client_updated_at}. With a food, the values are recomputed here
-- from the food; quick adds keep what was entered. Returns the stored row (or
-- null if it was deleted after this change).
create or replace function public.save_food_log(p_log jsonb)
returns public.food_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  lid uuid := (p_log ->> 'id')::uuid;
  changed timestamptz := public._change_time(p_log ->> 'client_updated_at');
  existing public.food_logs;
  f public.foods;
  v jsonb;
  result public.food_logs;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into existing from public.food_logs where id = lid;
  if found and existing.user_id <> uid then raise exception 'log belongs to someone else' using errcode = '42501'; end if;
  if exists (select 1 from public.sync_tombstones t where t.entity = 'food_log' and t.id = lid and t.user_id = uid
             and t.deleted_at >= changed) then
    return null;
  end if;
  if existing.id is not null and existing.client_updated_at > changed then return existing; end if;
  if (p_log ->> 'day')::date > current_date + 2 then raise exception 'can''t log food in the future' using errcode = '22023'; end if;

  select * into f from public.foods x where x.id = nullif(p_log ->> 'food_id', '')::uuid
    and (x.owner_id = uid or (x.owner_id is null and not x.is_hidden));
  if f.id is not null then
    v := public._portion(f, nullif(p_log ->> 'grams', '')::numeric, nullif(p_log ->> 'servings', '')::numeric);
  end if;

  insert into public.food_logs as l (id, user_id, day, meal, food_id, name, grams, servings, kcal, protein, carbs, fat, client_updated_at)
  values (
    lid, uid, (p_log ->> 'day')::date, p_log ->> 'meal', f.id,
    coalesce(f.name, btrim(p_log ->> 'name')),
    coalesce((v ->> 'grams')::numeric, nullif(p_log ->> 'grams', '')::numeric),
    nullif(p_log ->> 'servings', '')::numeric,
    coalesce((v ->> 'kcal')::numeric, (p_log ->> 'kcal')::numeric),
    coalesce((v ->> 'protein')::numeric, coalesce((p_log ->> 'protein')::numeric, 0)),
    coalesce((v ->> 'carbs')::numeric, coalesce((p_log ->> 'carbs')::numeric, 0)),
    coalesce((v ->> 'fat')::numeric, coalesce((p_log ->> 'fat')::numeric, 0)),
    changed
  )
  on conflict (id) do update set
    day = excluded.day, meal = excluded.meal, food_id = excluded.food_id, name = excluded.name,
    grams = excluded.grams, servings = excluded.servings, kcal = excluded.kcal, protein = excluded.protein,
    carbs = excluded.carbs, fat = excluded.fat, client_updated_at = excluded.client_updated_at, updated_at = now()
  returning * into result;
  delete from public.sync_tombstones where entity = 'food_log' and id = lid and user_id = uid;
  return result;
end $$;

create or replace function public.delete_food_log_at(p_id uuid, p_deleted_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed timestamptz := public._change_time(p_deleted_at::text);
  existing public.food_logs;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into existing from public.food_logs where id = p_id;
  if found then
    if existing.user_id <> uid then raise exception 'log % not found', p_id using errcode = 'P0002'; end if;
    if existing.client_updated_at > changed then return; end if;
    delete from public.food_logs where id = p_id;
  end if;
  perform public._tombstone('food_log', p_id, uid, changed);
end $$;

create or replace function public.save_water_log(p_id uuid, p_day date, p_ml integer, p_changed_at timestamptz default null)
returns public.water_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed timestamptz := public._change_time(p_changed_at::text);
  result public.water_logs;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.water_logs where id = p_id and user_id <> uid) then
    raise exception 'log belongs to someone else' using errcode = '42501';
  end if;
  if exists (select 1 from public.sync_tombstones t where t.entity = 'water_log' and t.id = p_id and t.user_id = uid
             and t.deleted_at >= changed) then
    return null;
  end if;
  insert into public.water_logs as w (id, user_id, day, ml, client_updated_at) values (p_id, uid, p_day, p_ml, changed)
  on conflict (id) do update set day = excluded.day, ml = excluded.ml, client_updated_at = excluded.client_updated_at
    where w.client_updated_at is null or w.client_updated_at <= excluded.client_updated_at
  returning * into result;
  return coalesce(result, (select x from public.water_logs x where id = p_id));
end $$;

create or replace function public.delete_water_log_at(p_id uuid, p_deleted_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  changed timestamptz := public._change_time(p_deleted_at::text);
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  delete from public.water_logs where id = p_id and user_id = uid
    and (client_updated_at is null or client_updated_at <= changed);
  perform public._tombstone('water_log', p_id, uid, changed);
end $$;

-- Idempotent, so a retried sync is harmless.
create or replace function public.set_food_favorite(p_food uuid, p_favorite boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_favorite then
    if not exists (select 1 from public.foods where id = p_food and (owner_id = uid or (owner_id is null and not is_hidden))) then
      raise exception 'food % not found', p_food using errcode = 'P0002';
    end if;
    insert into public.food_favorites (user_id, food_id) values (uid, p_food) on conflict do nothing;
  else
    delete from public.food_favorites where user_id = uid and food_id = p_food;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- For the food-search Edge Function (service role only)
-- ---------------------------------------------------------------------------

-- The user's own food with that barcode first, then the cached one.
create or replace function public.food_by_barcode(p_user uuid, p_barcode text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(f) || jsonb_build_object('stale', f.source = 'off' and f.fetched_at < now() - interval '30 days')
  from public.foods f
  where f.barcode = p_barcode and (f.owner_id = p_user or (f.owner_id is null))
  order by (f.owner_id is not null) desc
  limit 1
$$;

-- Local matches by name: own foods and cached ones (not hidden).
create or replace function public.food_search_local(p_user uuid, p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(f) order by (f.owner_id is not null) desc, f.name), '[]'::jsonb)
  from (
    select * from public.foods f
    where (f.owner_id = p_user or (f.owner_id is null and not f.is_hidden))
      and lower(f.name || ' ' || coalesce(f.brand, '')) like '%' || lower(btrim(p_query)) || '%'
    order by (f.owner_id is not null) desc, f.name
    limit 20
  ) f
$$;

-- Stores Open Food Facts products. Hidden ones (marked wrong by an admin)
-- are not changed; returns the stored rows.
create or replace function public.food_cache_upsert(p_foods jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with up as (
    insert into public.foods as f (source, barcode, name, brand, kcal_100g, protein_100g, carbs_100g, fat_100g,
                                   serving_g, serving_label, fetched_at)
    select 'off', x ->> 'barcode', left(btrim(x ->> 'name'), 120), nullif(left(btrim(x ->> 'brand'), 80), ''),
           least((x ->> 'kcal_100g')::numeric, 900), least(coalesce((x ->> 'protein_100g')::numeric, 0), 100),
           least(coalesce((x ->> 'carbs_100g')::numeric, 0), 100), least(coalesce((x ->> 'fat_100g')::numeric, 0), 100),
           nullif(x ->> 'serving_g', '')::numeric, nullif(left(btrim(x ->> 'serving_label'), 40), ''), now()
    from jsonb_array_elements(p_foods) x
    where x ->> 'barcode' ~ '^[0-9]{6,14}$' and btrim(coalesce(x ->> 'name', '')) <> '' and (x ->> 'kcal_100g') is not null
    on conflict (barcode) where source = 'off' do update set
      name = excluded.name, brand = excluded.brand, kcal_100g = excluded.kcal_100g, protein_100g = excluded.protein_100g,
      carbs_100g = excluded.carbs_100g, fat_100g = excluded.fat_100g, serving_g = excluded.serving_g,
      serving_label = excluded.serving_label, fetched_at = now(), updated_at = now()
      where not f.is_hidden
    returning f.*
  )
  select coalesce(jsonb_agg(to_jsonb(up) order by up.name), '[]'::jsonb) from up
$$;

-- Per-user limits for Open Food Facts lookups (raises when over).
create or replace function public.food_rate_check(p_user uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action = 'barcode' then
    perform public._rate_limit(p_user, 'food_barcode', 60, 300);
  else
    perform public._rate_limit(p_user, 'food_search', 30, 200);
  end if;
end $$;

-- AI context: 7-day (or week) average calories and protein vs targets, only
-- if food was logged in that window. Small on purpose.
create or replace function public.ai_nutrition_summary(p_user uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select day, sum(kcal) as kcal, sum(protein) as protein from public.food_logs
    where user_id = p_user and day between p_from and p_to group by day
  )
  select case when count(*) = 0 then null else jsonb_strip_nulls(jsonb_build_object(
    'days_logged', count(*),
    'avg_kcal', round(avg(kcal)),
    'avg_protein_g', round(avg(protein)),
    'target_kcal', (select kcal from public.nutrition_targets where user_id = p_user),
    'target_protein_g', (select protein_g from public.nutrition_targets where user_id = p_user)
  )) end
  from d
$$;

-- ---------------------------------------------------------------------------
-- Admin → Foods: review cached Open Food Facts foods (never users' own
-- foods or anyone's logs). Logged.
-- ---------------------------------------------------------------------------
create or replace function public.admin_foods(p_query text default '', p_hidden boolean default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(f) || jsonb_build_object('times_logged', (select count(*) from public.food_logs l where l.food_id = f.id))
                     order by f.updated_at desc)
    from (
      select * from public.foods f
      where f.source = 'off' and (p_hidden is null or f.is_hidden = p_hidden)
        and (btrim(coalesce(p_query, '')) = '' or f.barcode = btrim(p_query)
             or lower(f.name || ' ' || coalesce(f.brand, '')) like '%' || lower(btrim(p_query)) || '%')
      order by f.updated_at desc limit 100
    ) f
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_food_hidden(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.foods set is_hidden = p_hidden, updated_at = now() where id = p_id and source = 'off';
  if not found then raise exception 'food % not found', p_id using errcode = 'P0002'; end if;
  perform public.log_admin_action('food.hidden', 'food', p_id::text, jsonb_build_object('hidden', p_hidden));
end $$;

-- Fix wrong values. p_changes: any of name, brand, kcal_100g, protein_100g,
-- carbs_100g, fat_100g, serving_g, serving_label.
create or replace function public.admin_update_food(p_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before public.foods := (select x from public.foods x where id = p_id and source = 'off');
  k text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if before.id is null then raise exception 'food % not found', p_id using errcode = 'P0002'; end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('name', 'brand', 'kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g', 'serving_g', 'serving_label') then
      raise exception 'unknown field %', k using errcode = '22023';
    end if;
  end loop;
  update public.foods set
    name = coalesce(btrim(p_changes ->> 'name'), name), brand = case when p_changes ? 'brand' then nullif(btrim(p_changes ->> 'brand'), '') else brand end,
    kcal_100g = coalesce((p_changes ->> 'kcal_100g')::numeric, kcal_100g),
    protein_100g = coalesce((p_changes ->> 'protein_100g')::numeric, protein_100g),
    carbs_100g = coalesce((p_changes ->> 'carbs_100g')::numeric, carbs_100g),
    fat_100g = coalesce((p_changes ->> 'fat_100g')::numeric, fat_100g),
    serving_g = case when p_changes ? 'serving_g' then nullif(p_changes ->> 'serving_g', '')::numeric else serving_g end,
    serving_label = case when p_changes ? 'serving_label' then nullif(btrim(p_changes ->> 'serving_label'), '') else serving_label end,
    updated_at = now()
  where id = p_id;
  perform public.log_admin_action('food.update', 'food', p_id::text, jsonb_build_object(
    'changes', p_changes, 'before', (select jsonb_object_agg(key, to_jsonb(before) -> key) from jsonb_object_keys(p_changes) key)));
  return (select to_jsonb(f) from public.foods f where id = p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._portion(public.foods, numeric, numeric)', 'public.food_by_barcode(uuid, text)',
    'public.food_search_local(uuid, text)', 'public.food_cache_upsert(jsonb)', 'public.food_rate_check(uuid, text)',
    'public.ai_nutrition_summary(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.food_by_barcode(uuid, text)', 'public.food_search_local(uuid, text)', 'public.food_cache_upsert(jsonb)',
    'public.food_rate_check(uuid, text)', 'public.ai_nutrition_summary(uuid, date, date)'
  ] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.save_my_food(uuid, jsonb)', 'public.save_food_log(jsonb)', 'public.delete_food_log_at(uuid, timestamptz)',
    'public.save_water_log(uuid, date, integer, timestamptz)', 'public.delete_water_log_at(uuid, timestamptz)',
    'public.set_food_favorite(uuid, boolean)', 'public.admin_foods(text, boolean)',
    'public.admin_set_food_hidden(uuid, boolean)', 'public.admin_update_food(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
