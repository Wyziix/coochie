# Progress

App name: **LightweightBaby** · bundle ID / package `com.lightweightbaby.app` · slug `lightweightbaby`

## Plan changes (agreed 2026-10-29)

- **Stage 12 skipped.** No RevenueCat, no paywall, no premium tier. The server-side daily AI limit stays (Stage 6/7) and must be adjustable by an admin without a code change (a default limit plus per-user overrides in the database).
- **Stage 13:** no App Store / Google Play checklist. Instead: EAS internal distribution, an Android APK shareable by link, plus instructions for installing on iOS.
- **Account deletion stays** (Stage 11) even though we're not on the stores.
- **Distribution:** Android = APK through EAS (internal distribution). iPhone = the **web app installed as a PWA** (Safari → Share → Add to Home Screen). No native iOS build planned.
- **Web is a first-class target from Stage 1 on.** Every feature must work on web, or be hidden/disabled cleanly there (health sync, background notifications, barcode scanner if needed, etc.). Never crash on web.
- **Google login on web** uses the Supabase OAuth redirect (PKCE). Android uses native Google sign-in.
- **PWA:** installable, manifest + icons, name "LightweightBaby", `display: standalone`.
- **Stage 13 adds:** deploy the web app (EAS Hosting or Vercel, whichever is simpler and free), share the link, and write the iPhone "Add to Home Screen" steps.

## Stage status

| Stage | Name                                 | Status |
| ----- | ------------------------------------ | ------ |
| 0     | Project setup                        | Done   |
| 1     | Google login and onboarding          | –      |
| 2     | Exercise library and workout logging | –      |
| 3     | Templates and history                | –      |
| 4     | Progress tracking                    | –      |
| 5     | Offline mode and sync                | –      |
| 6     | Claude feedback                      | –      |
| 7     | AI plan generator and coach chat     | –      |
| 8     | Points and ranking                   | –      |
| 9     | Social                               | –      |
| 10    | Nutrition                            | –      |
| 11    | Health sync, export, settings        | –      |
| 12    | Premium subscription                 | –      |
| 13    | Polish and release                   | –      |

## Stage 0 – Project setup

Built:

- Expo SDK 58 (React Native 0.88, React 19.3), TypeScript strict + `noUncheckedIndexedAccess`, Expo Router with typed routes
- Folders: `app/`, `components/`, `lib/`, `stores/`, `hooks/`, `types/`, `supabase/{migrations,functions}`
- ESLint (eslint-config-expo flat + Prettier plugin), Prettier, Jest (jest-expo + React Native Testing Library 14)
- Supabase client (`lib/supabase.ts`) with session persisted in AsyncStorage and token refresh tied to app foreground
- `.env.example` (public app keys) and `supabase/functions/.env.example` (server secrets)
- Theme: light/dark tokens in `lib/theme`, `useTheme()` hook, follows system by default, manual override (System/Light/Dark) stored in Zustand + AsyncStorage. Navigation theme, status bar and Android system background follow it. Splash stays up until the saved preference is loaded so there's no flash
- UI components in `components/ui`: Text, Button, Input, Card, Screen, Header, EmptyState, LoadingState, SegmentedControl
- TanStack Query provider
- Bottom tabs: Home, Workout, Progress, Ranking, Profile (placeholders). Profile has the theme toggle and shows whether Supabase keys are set

Checks: typecheck, lint, prettier and 14 Jest tests pass (`npm run check`). Web, iOS and Android bundles export without errors. Screenshots of the web build checked in light, dark and manual-override modes.

### Decisions

- Routes in root `app/` (as in the plan) instead of the template's `src/app/`. Path alias `@/` points at the repo root
- JS bottom tabs (`expo-router/js-tabs`) instead of native tabs, so the tab bar looks the same on iOS and Android and is fully themeable
- Supabase client is created lazily via `getSupabase()` so the app boots before keys exist. It throws a clear error if keys are missing
- Supabase auth session stored in AsyncStorage (standard Supabase + Expo setup). Can move to expo-sqlite kv-store in Stage 5 if we want one storage layer
- Env var is `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase's newer key name; the legacy anon key also works there)
- `@expo/vector-icons` (Ionicons) for icons. Mocked in Jest because icon fonts can't load there
- Theme toggle placed on the Profile tab for now; it moves to Settings in Stage 11
- Renamed to LightweightBaby after Stage 0 (app.json name/slug/scheme, bundle ID, package.json name)

### Known issues

- Not run on real iOS/Android simulators yet (none available in the build environment). Native bundles compile; first simulator run is on you
- `expo-doctor`: 18/20 checks pass, the 2 failing ones need the Expo API, which was blocked in the build environment. Re-run locally

## Stage 1 – Google login and onboarding

Built:

- **Database** (`supabase/migrations/20261029000000_profiles.sql`): `profiles` table (username unique, display name, avatar, units, goal, experience, days/week, bodyweight in kg, height in cm, onboarding_completed_at, timestamps). RLS: users read/insert/update only their own row. Check constraints match the app's validation. A trigger creates the profile on signup, prefilled with the Google name and photo. `is_username_available()` RPC so availability can be checked without exposing other profiles. Public-read `avatars` bucket, users can only write in their own folder
- **DB tests**: `npm run test:db` runs the migrations on a throwaway local Postgres (with a small stub of Supabase's auth/storage schemas) and checks 25 RLS and constraint cases
- **Sign-in**: native Google sign-in on Android (`@react-native-google-signin/google-signin` → `signInWithIdToken`), Supabase OAuth redirect with PKCE on web. Session saved in AsyncStorage (localStorage on web), so it survives restarts
- **Protected routes** with `Stack.Protected`: logged out → sign-in only; logged in but not onboarded → onboarding only; onboarded → tabs + edit profile. Splash/loading stays up until the session and profile are known
- **Onboarding**: 6 steps (username with live availability check, units, goal, experience, days per week, bodyweight). Saves everything in kg
- **Profile tab**: avatar, name, username, training and body info, theme toggle, log out (with confirm, works on web too)
- **Edit profile**: display name, username, photo upload, units (switching converts typed numbers), bodyweight, height, goal, experience, days per week
- **PWA**: `public/index.html` (manifest link, Apple meta tags, viewport-fit=cover), `public/manifest.json` (standalone), placeholder barbell icons (192/512, maskable, apple-touch-icon)
- `app.config.ts` adds the iOS Google plugin only when an iOS client ID is set, so builds never fail on a missing ID
- `eas.json` with development / preview / production profiles (Android APK)
- `docs/SETUP.md`: Supabase, Google Cloud and EAS steps

Checks: typecheck, lint, prettier, 47 Jest tests, 25 DB tests. Web and native bundles export. Full web flow tested in a headless iPhone-sized browser against an intercepted fake Supabase: Google redirect (PKCE) → code exchange → onboarding → home → reload (still signed in) → deep link `/profile` → edit → log out. No page errors.

### Decisions

- One `profiles` row per auth user, created by a DB trigger. Onboarding is "done" when `onboarding_completed_at` is set; a DB constraint makes sure the required answers exist first
- Height follows the units setting (cm for kg, inches for lbs)
- Username rules: 3–20 chars, lowercase letters, numbers, `_`. Stored lowercase
- Avatars bucket is public-read (friends will see avatars in Stage 9). Paths include a timestamp so cached old photos don't stick
- Columns like admin flags or AI limits will go in separate tables (Stage 6) so users can't edit them through their own profile row
- `lib/confirm.ts`: confirm dialogs use `window.confirm` on web because `Alert.alert` does nothing there

### Known issues / to check

- Not tested against the real Supabase project yet: I need the **Supabase project URL** (only the publishable key was given)
- Google sign-in can't be tested here (needs your Google Cloud clients). Follow `docs/SETUP.md`
- iPhone PWA + Google redirect: the redirect flow is the right approach for home-screen web apps, but iOS standalone mode sometimes opens OAuth in a separate browser sheet. Test it early on her phone once the web app is reachable; if it's flaky, the fallback is an email magic link for web
- Stage 5 (offline on web): expo-sqlite on web needs extra HTTP headers (COOP/COEP). This affects which host we pick in Stage 13
- PWA icons are placeholders; real icon in Stage 13
