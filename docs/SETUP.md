# Setup: Supabase, Google sign-in, builds

Do these once. Values in `<angle brackets>` are yours.

## 1. Supabase project

1. Project Settings → API: copy the **Project URL** and the **publishable key**.
2. Put both in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
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
