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
   - Authorized JavaScript origins: `http://localhost:8081` (later also the deployed web URL)
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
  - Site URL: `http://localhost:8081` for now (the deployed web URL after Stage 13)
  - Redirect URLs: `http://localhost:8081/**` (and later `https://<deployed-url>/**`)

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
select policyname from pg_policies where schemaname = 'storage' and policyname like 'progress-photos:%';  -- 4 rows
```

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
