-- Stage 10: nutrition. Owner-only data (RLS on every table), food logs and
-- water through the offline sync rules (last write wins, tombstones, retries
-- are harmless), the Open Food Facts cache, rate limits, admin review, and
-- the small AI summary.
\set ON_ERROR_STOP on
begin;
\ir helpers.sql

select pg_temp.new_user('a0a00000-0000-0000-0000-00000000000a', 'nut-a@test.dev');
select pg_temp.new_user('a0a00000-0000-0000-0000-00000000000b', 'nut-b@test.dev');
select pg_temp.new_user('a0a00000-0000-0000-0000-00000000000c', 'nut-admin@test.dev');
update public.profiles set username = 'nut_a' where id = 'a0a00000-0000-0000-0000-00000000000a';
update public.profiles set username = 'nut_b' where id = 'a0a00000-0000-0000-0000-00000000000b';
update public.profiles set username = 'nut_admin', role = 'admin' where id = 'a0a00000-0000-0000-0000-00000000000c';
create function pg_temp.u(c text) returns uuid language sql as $$ select ('a0a00000-0000-0000-0000-00000000000' || c)::uuid $$;
create function pg_temp.l(n int) returns uuid language sql as $$ select ('b0b00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- The Edge Function caches Open Food Facts products (service role).
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
end $$;
select pg_temp.as_service();
select public.food_cache_upsert('[
  {"barcode": "3017620422003", "name": "Nutella", "brand": "Ferrero", "kcal_100g": 539, "protein_100g": 6.3, "carbs_100g": 57.5, "fat_100g": 30.9, "serving_g": 15, "serving_label": "15 g"},
  {"barcode": "5000112637922", "name": "Cola", "kcal_100g": 42, "carbs_100g": 10.6},
  {"barcode": "123", "name": "bad barcode", "kcal_100g": 1},
  {"barcode": "4000000000001", "name": "", "kcal_100g": 1}
]');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.foods where source = 'off'), 'cache keeps valid products only');
select pg_temp.as_service();
select public.food_cache_upsert('[{"barcode": "5000112637922", "name": "Cola Original", "kcal_100g": 42, "carbs_100g": 10.6}]');
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 and min(name) = 'Cola Original' from public.foods where barcode = '5000112637922'),
  'a repeat lookup updates the cached product (no duplicate)');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.expect_error($$select public.food_cache_upsert('[]')$$, 'clients can''t write the cache');

-- Own foods: only the owner sees them.
select pg_temp.login(pg_temp.u('a'));
create temp table own as select (public.save_my_food(null, '{"name": "Mum''s lasagne", "barcode": "2000000000017",
  "kcal_100g": 160, "protein_100g": 9, "carbs_100g": 14, "fat_100g": 7, "serving_g": 350, "serving_label": "1 plate"}')).id;
grant select on own to authenticated, service_role;
select pg_temp.check((select count(*) = 3 from public.foods), 'I see cached foods and my own');
select pg_temp.expect_error($$insert into public.foods (source, name, kcal_100g) values ('off', 'x', 1)$$, 'foods aren''t written directly');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select count(*) = 2 from public.foods), 'others don''t see my own foods');
select pg_temp.expect_error($$select public.save_my_food((select id from own), '{"name": "hijack", "kcal_100g": 1}')$$, 'or change them');
select pg_temp.as_service();
select pg_temp.check((select public.food_by_barcode(pg_temp.u('a'), '2000000000017') ->> 'name' = 'Mum''s lasagne'
  and public.food_by_barcode(pg_temp.u('b'), '2000000000017') is null), 'barcode lookup finds my own food, not someone else''s');

-- Logging: values come from the food on the server; quick adds keep what was typed.
select pg_temp.login(pg_temp.u('a'));
select public.save_food_log(jsonb_build_object('id', pg_temp.l(1), 'day', '2026-11-02', 'meal', 'breakfast',
  'food_id', (select id from public.foods where barcode = '3017620422003'), 'grams', 30, 'kcal', 1, 'client_updated_at', now()));
select pg_temp.check((select kcal = 161.7 and protein = 1.9 and name = 'Nutella' from public.food_logs where id = pg_temp.l(1)),
  '30 g of Nutella: 161.7 kcal computed on the server (the app''s number is ignored)');
select public.save_food_log(jsonb_build_object('id', pg_temp.l(2), 'day', '2026-11-02', 'meal', 'dinner',
  'food_id', (select id from own), 'servings', 1.5, 'kcal', 0, 'client_updated_at', now()));
select pg_temp.check((select grams = 525 and kcal = 840 from public.food_logs where id = pg_temp.l(2)), '1.5 servings of 350 g');
select public.save_food_log(jsonb_build_object('id', pg_temp.l(3), 'day', '2026-11-02', 'meal', 'snack', 'name', 'Protein bar',
  'kcal', 210, 'protein', 20, 'client_updated_at', now()));
select pg_temp.check((select kcal = 210 and protein = 20 and food_id is null from public.food_logs where id = pg_temp.l(3)), 'quick add');
select pg_temp.expect_error($$select public.save_food_log(jsonb_build_object('id', gen_random_uuid(), 'day', current_date + 10,
  'meal', 'lunch', 'name', 'x', 'kcal', 1))$$, 'not in the future');
select pg_temp.expect_error($$insert into public.food_logs (id, user_id, day, meal, name, kcal) values (gen_random_uuid(), auth.uid(), current_date, 'lunch', 'x', 1)$$,
  'logs only through the functions');

-- Offline sync rules: same id twice = no duplicate; an older change loses;
-- a delete wins over older saves; tombstone stops a late re-sync.
select public.save_food_log(jsonb_build_object('id', pg_temp.l(3), 'day', '2026-11-02', 'meal', 'snack', 'name', 'Protein bar',
  'kcal', 210, 'protein', 20, 'client_updated_at', now()));
select pg_temp.check((select count(*) = 3 from public.food_logs), 'synced twice: still one log');
select public.save_food_log(jsonb_build_object('id', pg_temp.l(3), 'day', '2026-11-02', 'meal', 'snack', 'name', 'Old bar',
  'kcal', 999, 'client_updated_at', now() - interval '1 hour'));
select pg_temp.check((select name = 'Protein bar' from public.food_logs where id = pg_temp.l(3)), 'an older change doesn''t overwrite a newer one');
select public.delete_food_log_at(pg_temp.l(3), now());
select pg_temp.check((select public.save_food_log(jsonb_build_object('id', pg_temp.l(3), 'day', '2026-11-02', 'meal', 'snack', 'name', 'Protein bar',
  'kcal', 210, 'client_updated_at', now() - interval '1 minute')) is null), 'a save made before the delete doesn''t bring it back');
select pg_temp.check((select count(*) = 2 from public.food_logs), 'deleted');
select public.delete_food_log_at(pg_temp.l(3), now());
select pg_temp.check(true, 'deleting again is fine (retries)');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.expect_error(format($$select public.save_food_log(jsonb_build_object('id', %L, 'day', '2026-11-02', 'meal', 'lunch', 'name', 'x', 'kcal', 1))$$, pg_temp.l(1)),
  'nobody can overwrite my log by reusing its id');
select pg_temp.expect_error(format($$select public.delete_food_log_at(%L, now())$$, pg_temp.l(1)), 'or delete it');

-- Water.
select pg_temp.login(pg_temp.u('a'));
select public.save_water_log(pg_temp.l(10), '2026-11-02', 250, now());
select public.save_water_log(pg_temp.l(10), '2026-11-02', 250, now());
select public.save_water_log(pg_temp.l(11), '2026-11-02', 500, now());
select pg_temp.check((select sum(ml) = 750 from public.water_logs), '+250 (synced twice) and +500 = 750 ml');
select public.delete_water_log_at(pg_temp.l(11), now());
select pg_temp.check((select public.save_water_log(pg_temp.l(11), '2026-11-02', 500, now() - interval '1 minute') is null
  and (select sum(ml) from public.water_logs) = 250), 'water delete wins over an older re-sync');

-- Favourites and targets.
select public.set_food_favorite((select id from public.foods where barcode = '3017620422003'), true);
select public.set_food_favorite((select id from public.foods where barcode = '3017620422003'), true);
select pg_temp.check((select count(*) = 1 from public.food_favorites), 'favourite (idempotent)');
insert into public.nutrition_targets (user_id, kcal, protein_g, carbs_g, fat_g, method) values (auth.uid(), 2400, 160, 260, 80, 'mifflin_st_jeor');
select pg_temp.expect_error($$insert into public.nutrition_targets (user_id, kcal, protein_g, carbs_g, fat_g)
  values ('a0a00000-0000-0000-0000-00000000000b', 1, 1, 1, 1)$$, 'targets only for myself');

-- Privacy: other users see none of it.
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select count(*) = 0 from public.food_logs) and (select count(*) = 0 from public.water_logs)
  and (select count(*) = 0 from public.food_favorites) and (select count(*) = 0 from public.nutrition_targets),
  'another user sees no logs, water, favourites or targets');
select pg_temp.check((select not (public.feed()::text ilike '%kcal%') and not (public.feed()::text ilike '%nutella%')),
  'nothing about food in the feed');
select pg_temp.logout();
select pg_temp.check((select not exists (select 1 from public.activity where user_id = pg_temp.u('a'))), 'logging food creates no activity');
select pg_temp.check((select not exists (select 1 from public.points_ledger where user_id = pg_temp.u('a'))), 'or points');

-- Hidden (wrong) cached food: invisible to users, not refreshed from Open Food Facts.
select pg_temp.login(pg_temp.u('b'));
select pg_temp.expect_error($$select public.admin_foods()$$, 'only admins review foods');
select pg_temp.login(pg_temp.u('c'));
select pg_temp.check((select jsonb_array_length(public.admin_foods()) = 2 and not (public.admin_foods()::text like '%lasagne%')),
  'admin sees cached foods only, never users'' own foods');
select public.admin_update_food((select id from public.foods where barcode = '5000112637922'), '{"kcal_100g": 43}');
select public.admin_set_food_hidden((select id from public.foods where barcode = '5000112637922'), true);
select pg_temp.expect_error($$select public.admin_update_food((select id from own), '{"kcal_100g": 1}')$$, 'and can''t edit them');
select pg_temp.logout();
select pg_temp.check((select count(*) = 2 from public.admin_actions where action in ('food.update', 'food.hidden')
  and (details -> 'before' ->> 'kcal_100g')::numeric = 42 or action = 'food.hidden'), 'logged with the old value');
select pg_temp.login(pg_temp.u('b'));
select pg_temp.check((select count(*) = 1 from public.foods), 'hidden food not shown to users');
select pg_temp.as_service();
select public.food_cache_upsert('[{"barcode": "5000112637922", "name": "Cola from OFF", "kcal_100g": 42}]');
select pg_temp.logout();
select pg_temp.check((select name = 'Cola Original' and kcal_100g = 43 from public.foods where barcode = '5000112637922'),
  'a hidden food isn''t overwritten by the next lookup');

-- Rate limit for lookups.
insert into public.social_rate_log (user_id, action) select pg_temp.u('b'), 'food_barcode' from generate_series(1, 60);
select pg_temp.as_service();
select pg_temp.expect_error($$select public.food_rate_check('a0a00000-0000-0000-0000-00000000000b', 'barcode')$$, '61st barcode lookup in an hour is refused');
select public.food_rate_check('a0a00000-0000-0000-0000-00000000000b', 'search');

-- AI summary: only with logs, small.
select pg_temp.check((select public.ai_nutrition_summary(pg_temp.u('b'), '2026-10-27', '2026-11-02') is null), 'no food logged: nothing for the AI');
select pg_temp.check((select public.ai_nutrition_summary(pg_temp.u('a'), '2026-10-27', '2026-11-02')
  = '{"days_logged": 1, "avg_kcal": 1002, "avg_protein_g": 49, "target_kcal": 2400, "target_protein_g": 160}'::jsonb),
  '7-day average calories and protein vs targets');
select pg_temp.login(pg_temp.u('a'));
select pg_temp.expect_error($$select public.ai_nutrition_summary(auth.uid(), current_date - 7, current_date)$$, 'clients can''t call the AI summary');

rollback;
\echo 'nutrition tests passed'
