# Setup: Supabase, Google sign-in, builds

Do these once. Values in `<angle brackets>` are yours.

## 1. Supabase project

1. Project Settings → API: copy the **Project URL** and the **publishable key**.
2. Put both in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://gwyymvaxgmpamtiuhoez.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
3. Apply the database migrations (creates `profiles`, RLS policies, the `avatars` bucket):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   No CLI? Paste each file from `supabase/migrations/` into the SQL Editor, oldest first.

## 2. Google Cloud (OAuth clients)

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services:

1. **OAuth consent screen**: External, app name LightweightBaby. While it's in "Testing", add every Google account that will sign in (you and your girlfriend) as **test users**.
2. **Credentials → Create OAuth client ID → Web application** (used by Supabase, the web app and Android):
   - Authorized JavaScript origins: `http://localhost:8081` (and the live URL, see section 9)
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Copy the client ID and client secret.
3. **Create OAuth client ID → Android** (lets the APK use native sign-in):
   - Package name: `com.lightweightbaby.app`
   - SHA-1: from `npx eas-cli@latest credentials -p android` (after the first EAS build creates the keystore). Add one Android client per keystore (development and preview builds share one if you use the same EAS credentials).
4. iOS client: not needed. iPhone uses the web app.

Put the web client ID in `.env`:

```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
```

## 3. Supabase auth settings

- Authentication → Sign In / Providers → **Google**: enable, paste the **web** client ID and secret.
- Authentication → URL Configuration:
  - Site URL: `http://localhost:8081` for now (the live URL once deployed, see section 9)
  - Redirect URLs: `http://localhost:8081/**` (and the live URL, see section 9)

## 4. Run it

Web (fastest way to test login):

```bash
npx expo start --web
```

Android needs a development build (native Google sign-in isn't in Expo Go):

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value <url> --visibility plaintext
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <key> --visibility plaintext
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <id> --visibility plaintext
npx eas-cli@latest build --profile development --platform android
```

Install the APK from the link EAS gives you, then run `npx expo start` and open the project from the dev client. (`.env` is git-ignored, so EAS builds read the values from EAS environment variables instead.)

## 5. New migrations (after Stage 1)

Two more migrations were added:

- `20261030000000_roles_admin.sql`: `role` column, `is_admin()`, the access token hook function, `admin_actions` log, and makes kopenkin.ne@gmail.com admin
- `20261030010000_exercises_workouts.sql`: exercise library (106 exercises), rest settings, workouts, sets

Apply them:

```bash
npx supabase db push
```

Or paste each file into the SQL Editor (roles first, then exercises). Check that it worked:

```sql
select u.email, p.role
from public.profiles p join auth.users u using (id)
where p.role = 'admin';

select count(*) from public.exercises where owner_id is null;  -- 106
```

### Stage 3 migration

- `20261031000000_templates_history.sql`: templates + 8 ready-made ones, admin template functions, `template_id` on workouts, and workout writes moved to server functions only (`save_workout` v2, `delete_workout`)

```sql
select program, name from public.templates where owner_id is null order by program, position;  -- 8 rows
```

### Stage 4 migration

- `20261101000000_progress.sql`: personal records (calculated by `save_workout` / `delete_workout`, existing workouts backfilled), body measurements (newest bodyweight is copied to the profile), progress photos and the private `progress-photos` storage bucket with own-folder policies. Safe to run twice

```sql
select record_type, count(*) from public.personal_records group by 1;  -- rows if you've logged workouts
select id, public, file_size_limit from storage.buckets where id = 'progress-photos';  -- public = false
select policyname from pg_policies where schemaname = 'storage' and policyname like 'progress-photos:%';  -- 4 rows (0 after the photo lock migration)
```

### Photo lock migration + Edge Function

- `20261102000000_photo_lock.sql`: PIN / password for progress photos (bcrypt via pgcrypto), 5-minute unlock tokens, 5 wrong tries → 15 minutes locked, Forgot PIN only after a fresh Google sign-in, Android device keys. Removes all direct app access to photo rows and files. Safe to run twice
- If a migration fails halfway, re-run **that same file**. Don't re-run older files after newer ones (an old file can put back an older version of a function)

```sql
select count(*) from pg_policies where schemaname = 'storage' and policyname like 'progress-photos:%';  -- 0 now
select has_table_privilege('authenticated', 'public.progress_photos', 'select');  -- false
select proname from pg_proc where proname like 'photo\_%' order by 1;  -- photo_add … photo_unlock (13)
```

Then deploy the `photos` Edge Function (it signs photo URLs and stores uploads, only with a valid unlock token):

```bash
npx supabase@2.122.0 login
npm run deploy:functions
```

`deploy:functions` runs `supabase functions deploy photos --no-verify-jwt --use-api --project-ref gwyymvaxgmpamtiuhoez`. No Docker needed. JWT verification at the gateway is off on purpose: the function forwards your login token to the database, which checks it (this also works with the new publishable/secret keys). It needs no secrets of its own; Supabase provides the project URL and keys to every function.

No CLI? Dashboard → Edge Functions → Deploy a new function → name `photos`, add the files `index.ts` and `handler.ts` from `supabase/functions/photos/`, deploy, then in the function's settings turn **Enforce JWT verification** off.

Check: in the app, open Progress photos → set a PIN → add a photo. Dashboard → Edge Functions → photos → Logs shows the calls.

### Stage 5 migration (offline sync)

- `20261104000000_offline_sync.sql`: `client_updated_at` on workouts and templates (last write wins by the time the change was made on the device), `sync_tombstones` (deleted ids), `save_workout` v4, `delete_workout_at`, `save_template` with app-picked ids, `delete_template`. Safe to run twice

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name in ('workouts', 'templates') and column_name = 'client_updated_at';  -- 2 rows
select proname from pg_proc where proname in ('delete_workout_at', 'delete_template', '_change_time') order by 1;  -- 3 rows
select relrowsecurity from pg_class where oid = 'public.sync_tombstones'::regclass;  -- true
```

Apply it before using the new app version: without it, workout saves still go through, but deleting a workout or creating a template shows "Couldn't sync" (the server is missing the new functions). Nothing is lost; tap Retry on the Sync screen after applying it.

### Stage 6 migration (Claude feedback)

1. Dashboard → Database → Extensions: turn on **pg_cron** and **pg_net** (needed for the Monday reports).
2. Run `20261106000000_ai_feedback.sql` (safe to run twice). It creates `ai_settings` (kill switch, daily limit 3, spending cap $0.50/day, model `claude-haiku-5-5`, prices), `ai_limit_overrides`, `ai_usage`, `ai_feedback`, `push_tokens`, the reservation/cost functions, the data summaries sent to Claude, the admin functions, and schedules the weekly job.

```sql
select enabled, daily_limit, daily_budget_usd, model, max_tokens_feedback, max_tokens_weekly from public.ai_settings;
select jobname, schedule, command from cron.job where jobname = 'weekly-ai-reports';  -- 15 6 * * 1-3
```

If the second query fails or returns nothing, the extensions weren't on: turn them on and run the file again.

3. The Claude key: already set as the `ANTHROPIC_API_KEY` function secret. It is only read inside the Edge Functions; it is never in the app, the repo or `.env`. No other secret is needed (the Monday job proves itself with a one-time token stored in the database).
4. Deploy the functions (`photos`, `workout-feedback`, `weekly-report`):
   ```bash
   npm run deploy:functions
   ```
5. Redeploy the web app: `npm run deploy:web`.

The model is one value: `ai_settings.model`, changeable in Admin → AI (or SQL). If you switch models, also update the four prices there, so the logged cost stays right.

## 6. Enable the custom access token hook

This puts `user_role` (`user` / `admin`) into every login token.

1. Dashboard → **Authentication** → **Hooks** (under Configuration)
2. **Add hook** → **Customize Access Token (JWT) Claims hook**
3. Hook type: **Postgres**. Schema: `public`. Function: `custom_access_token_hook`
4. **Create hook**
5. Log out and back in (tokens are only rebuilt on sign-in or refresh)

Test it in the SQL Editor:

```sql
select public.custom_access_token_hook(
  jsonb_build_object('user_id', id, 'claims', '{}'::jsonb)
) -> 'claims' ->> 'user_role'
from auth.users where email = 'kopenkin.ne@gmail.com';   -- admin
```

The app uses the claim only for display. Every admin action is checked on the server with `is_admin()`, which reads the `profiles` table, so taking admin away works immediately.

Make someone admin (or remove it). Only possible in SQL or with the service key:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'someone@example.com');
```

## 7. Email sign-in (code + magic link)

1. Authentication → Sign In / Providers → **Email**: enabled (default). "Email OTP Length" can stay at 6.
2. Authentication → **Emails** → **Magic Link** template. Add the code so it can be typed into the app. This matters for the iPhone home-screen app, because a link from Mail opens in Safari, which doesn't share login storage with the installed web app:
   ```html
   <h2>Your LightweightBaby sign-in code</h2>
   <p style="font-size:28px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
   <p>Or tap this link on the device you're signing in on:</p>
   <p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
   ```
   Do the same for the **Confirm signup** template (first-time email users get that one).
3. The built-in email sender only allows a few emails per hour. If codes stop arriving, set up custom SMTP (Authentication → Emails → SMTP Settings; e.g. Resend's free tier).

## 8. Node and npm versions

The lock file is written by **npm 11**. npm 10 writes it differently (it adds `"dev": true` to a few optional packages), which made `npm install` change `package-lock.json` and block `git pull`. `package.json` now requires npm 11 and `.npmrc` has `engine-strict=true`, so npm 10 stops with an error instead of rewriting the lock.

```bash
node -v   # 22.12 or newer; .nvmrc says 24
npm -v    # must be 11.x
```

If npm is 10: `npm install -g npm@11`. If your lock file is already modified, reset it before pulling: `git checkout package-lock.json`, then `git pull`, then `npm install` (it won't change the file any more). EAS builds use Node 24.11.1 (set in `eas.json`), which ships with npm 11.

## 9. Web app (Cloudflare Pages)

The web app is a static site on Cloudflare Pages (free; custom response headers in `public/_headers`, applied to every file). URL: `https://lightweightbaby.pages.dev` (if that name is taken, use another and replace it everywhere below).

### First deploy

1. Create a free account at https://dash.cloudflare.com/sign-up (no card needed).
2. Log in the CLI (opens the browser):
   ```bash
   npx wrangler@4.155.0 login
   ```
3. Create the project once:
   ```bash
   npx wrangler@4.155.0 pages project create lightweightbaby --production-branch main
   ```
4. Build and upload (uses the values in your `.env`):
   ```bash
   npm run deploy:web
   ```
   It prints the URL. With a different project name: `CF_PAGES_PROJECT=<name> npm run deploy:web`.

### Dashboard changes for login on the live URL

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://lightweightbaby.pages.dev`
- **Redirect URLs**: add `https://lightweightbaby.pages.dev/**` (keep `http://localhost:8081/**` for development)

Google Cloud Console → APIs & Services → Credentials → your **Web application** client:

- **Authorized JavaScript origins**: add `https://lightweightbaby.pages.dev`
- **Authorized redirect URIs**: no change (stays `https://gwyymvaxgmpamtiuhoez.supabase.co/auth/v1/callback`)
- OAuth consent screen: while it's in "Testing", every Google account that signs in must be a **test user** (add your girlfriend's).

Changes in Google can take a few minutes to apply.

### Headers

`public/_headers` sets `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` and long caching for the hashed JS/asset files. None of them affects Google login (a full-page redirect), Supabase calls or photo uploads (both normal CORS requests); this was checked with the production build at 390 px and 1440 px. HTML is served with `max-age=0, must-revalidate`, so a new deploy shows up the next time the app is opened.

No cross-origin isolation (COOP/COEP): offline data on web uses IndexedDB, which doesn't need it, so Google profile pictures and avatars keep loading. The service worker (`/sw.js`) is served with `Cache-Control: no-cache` so updates are found.

### On the iPhone

1. Open `https://lightweightbaby.pages.dev` in **Safari** (not Chrome; only Safari can install it).
2. Share button → **Add to Home Screen** → the name shows "LightweightBaby" → **Add**.
3. Open it from the new icon. It opens full screen, without Safari's address bar.
4. **Sign in inside the home-screen app**, not in Safari: iPhone keeps their logins separate. If Google sign-in comes back to Safari instead of the app, use "Use email instead" and type the 6-digit code.
5. Close the app (swipe it away) and open it again from the icon: it should still be signed in.

iOS may shorten the name under the icon ("LightweightB…") if it doesn't fit.

### Redeploying

After pulling new code:

```bash
npm run deploy:web
```

`deploy:web` builds the app, generates the service worker (`dist/sw.js`, the list of files to keep for offline use) and uploads. People with the app open get an "Update available, tap to reload" banner (the new version downloads in the background); otherwise they get it the next time they open the app and tap the banner. Nothing to clear by hand.

Apply new migrations first (and `npm run deploy:functions` if `supabase/functions` changed). Every deploy also gets its own preview URL (`<hash>.lightweightbaby.pages.dev`); to sign in on those, add `https://*.lightweightbaby.pages.dev/**` to the Supabase Redirect URLs. Roll back in Cloudflare → Workers & Pages → lightweightbaby → Deployments → "Rollback" on an older deployment.

## 10. Offline mode

- **Web / iPhone:** works after the app has been opened once online (it then has the app itself and your data). Install it on the home screen and open it once with a connection after each update. Data lives in IndexedDB; the service worker never stores Supabase responses.
- **Android:** offline data lives in SQLite. The new native modules (expo-sqlite, expo-network, expo-local-authentication) need a new build:
  ```bash
  npx eas-cli@latest build --profile preview --platform android
  ```
- Changes made offline are sent automatically when the connection is back. "N changes waiting to sync" in the tab headers opens the Sync screen; changes the server refused show there with the reason (Retry / Discard).
- If a migration fails halfway, re-run **that same file** only. Re-running an older file after a newer one can put back an older version of a server function (e.g. `save_workout` without last-write-wins).

## 11. AI feedback and weekly reports

- **Limits:** 3 requests per user per day (Admin → AI → "AI requests per user per day", per-user overrides below it). Checked in the database before Claude is called, under a lock, so two quick taps can't both get through. Failed calls don't use up a request. Days count in Europe/Madrid.
- **Spending cap:** Admin → AI → "Daily spending cap" (default $0.50/day, everyone together). When today's logged cost reaches it, AI pauses for everyone until the next day. A typical call costs about $0.0002-0.0003.
- **Kill switch:** Admin → AI → "Turn AI off" stops every AI call immediately.
- **Usage:** Admin → AI shows the last 30 days (calls, cost, errors, top users). Every call is in `ai_usage` with tokens and cost:
  ```sql
  select created_at, function, status, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, error
  from public.ai_usage order by created_at desc limit 20;
  ```
- **Weekly reports:** pg_cron runs `ai_start_weekly_run()` Mondays at 06:15 UTC (catch-up Tuesday and Wednesday for anyone skipped by the cap or the kill switch). It reports last week (Mon-Sun) for users who trained. Admin → AI → "Generate my report now" writes your own report for the current week (for testing).
- **Notifications:** iPhone (web app): a "New weekly report" card on Home until you open it. Android: a push notification, once push is set up:
  1. In Firebase create a project with an Android app `com.lightweightbaby.app`, download `google-services.json` into the repo root and add `"googleServicesFile": "./google-services.json"` under `android` in `app.json`.
  2. Firebase → Project settings → Service accounts → generate a key; then `npx eas-cli@latest credentials -p android` → Google Service Account → FCM V1 → upload it.
  3. Make sure the project is linked to EAS (`npx eas-cli@latest init` adds `extra.eas.projectId`), then build a new APK. Open Weekly reports and tap "Notify me when a report is ready".
     Without this, Android shows the same in-app card as the iPhone.
