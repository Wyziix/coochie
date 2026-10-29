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

- Tested by you against the real project (`gwyymvaxgmpamtiuhoez`): Google login on web works, migration applied
- iPhone PWA + Google redirect: the redirect flow is the right approach for home-screen web apps, but iOS standalone mode sometimes opens OAuth in a separate browser sheet. Test it early on her phone once the web app is reachable; if it's flaky, the fallback is an email magic link for web
- Stage 5 (offline on web): expo-sqlite on web needs extra HTTP headers (COOP/COEP). This affects which host we pick in Stage 13
- PWA icons are placeholders; real icon in Stage 13

## Stage 1 additions – roles, secure session, email login

Built:

- **Roles** (`20261030000000_roles_admin.sql`): `profiles.role` (`user` default / `admin`). Users can't set or change it: the RLS insert/update policies require the role to stay what it was, and a trigger blocks it as a second layer. Only SQL (postgres) or the service key can change roles
- `is_admin()` for policies and admin functions. It reads the table, not the JWT, so removing admin works immediately
- **Custom access token hook** `custom_access_token_hook` adds `user_role` to the JWT (enable it in the dashboard, see `docs/SETUP.md` §6)
- **kopenkin.ne@gmail.com made admin** by email match in the migration
- **`admin_actions` log** (admin id, action, target type/id, details, created_at). Only admins can read it; nobody can write it directly. Every admin function calls `log_admin_action()`, which also raises for non-admins (rolling back the change)
- **Admin tab**: visible to admins only (`Tabs.Protected`), `/admin` redirects others. Sections for later stages listed as "coming in stage X"
- **Secure session on native** (`lib/auth/sessionStorage.ts`): LargeSecureStore pattern. A fresh AES-256 key per write goes in SecureStore (Keychain / Keystore), and the session encrypted with AES-CTR goes in AsyncStorage. Sessions saved by older builds are read once and re-saved encrypted. Web keeps localStorage
- **Email login**: "Use email instead" → 6-digit code by email (`signInWithOtp` + `verifyOtp`). The email also has a magic link that works when opened in the same browser. The code is what makes it work in the iPhone home-screen app

DB tests: role rules — users can't promote themselves (checked with and without the trigger), non-admins can't call any admin function, read the log or write it, the hook adds the right claim, demotion is immediate.

## Stage 2 – Exercise library and workout logging

Built:

- **Database** (`20261030010000_exercises_workouts.sql`):
  - `exercises`: 106 global exercises (name, primary/secondary muscles, equipment, type weights/bodyweight/cardio/timed, how-to, default rest). Users' custom exercises have `owner_id` and are visible only to them. Global ones are written only through `admin_save_exercise` / `admin_set_exercise_hidden` (admin check + log)
  - Hidden exercises stay readable so old workouts keep their names; the picker leaves them out
  - `user_exercise_settings`: rest time per user per exercise
  - `workouts` + `workout_sets` with RLS. IDs are made on the device so retries can't duplicate (ready for Stage 5 sync)
  - `save_workout()`: saves workout + sets in one transaction, idempotent on the workout id; duration and volume are computed on the server
  - `last_exercise_sets()`: sets from the most recent workout per exercise ("last time")
- **Workout tab**: start an empty workout, resume card for one in progress, last 5 workouts
- **Active workout** (`/workouts/active`): editable name, timer, live set count and volume. Per exercise: set rows with "previous" column (tap to copy), weight/reps (or time/distance for timed and cardio), done checkbox. Empty fields use last time's values when you tick done. Set menu: type (warm-up/normal/drop/failure), optional RPE, delete. Exercise menu: rest time (saved for next time), how-to, remove
- **Rest timer**: starts when a set is ticked, ±15 s, skip. Native: local notification even with the app in the background, plus haptics in the app. **Web: beep (Web Audio) + vibration where supported** (Android Chrome; iPhones have no vibration API). Survives reload; if it ended while closed, it clears quietly
- **Plate calculator** (kg and lbs plates, bar choice, closest load if not exact)
- **Units**: everything stored in kg / seconds / meters; shown in kg or lbs (km or miles) from the profile. A workout keeps the unit it started with
- **Finish**: confirms, warns about unfinished sets (not saved), saves, shows a summary. **Discard** with confirmation. If saving fails, the workout stays on the device
- **Active workout survives closing the app or reloading the page** (persisted Zustand store: AsyncStorage / localStorage)
- **Exercise picker**: search (all words, accent-insensitive), muscle and equipment filters, multi-select, how-to page, create custom exercise
- **Admin → Exercise library**: list incl. hidden, add, edit, hide/unhide global exercises

Checks: typecheck, lint, prettier, 83 Jest tests, 72 DB checks (`npm run test:db`). Native + web bundles export. Web tested in a headless iPhone-sized browser (fake backend): email-code login, admin tab, picker, logging sets, **page reload mid-workout (sets and running timer kept)**, rest-end beep + vibration, plate calculator, rest setting saved, finish with unfinished-set warning, summary, admin hide. No page errors.

### Decisions

- Only completed sets are saved; you're warned about the rest on finish
- Inputs keep what you typed (strings in the workout's unit) and convert on save, so switching focus never reformats your numbers
- Admin UI check uses `profiles.role` (fresh); the JWT claim is there for Edge Functions later
- Switched accessibility props to `aria-*` (react-native-web ignores `accessibilityState`), so screen readers on web see checked/selected states
- Workout history beyond the last 5, editing/deleting past workouts, and templates are Stage 3

### Known issues / to check

- Rest notification on Android needs the dev build (not Expo Go) and notification permission; asked when you start the first workout
- On iPhone (web app), the beep only plays while the app is open and the screen is on. iOS doesn't allow background alerts for web apps
- The exercise list is fetched online; offline use comes in Stage 5

## Stage 2 fixes (after testing on web)

- **Filter chips squashed**: with a long list below, flexbox shrank the horizontal chip rows to a few pixels (react-native-web gives ScrollView `flexShrink: 1`). It only looked fine before because my test had a filtered, short list. New `ChipRow` component: fixed 36 px height, never shrinks, scrolls horizontally. Chips have a fixed height and one-line labels
- **Nested `<button>` on web**: the Workout tab's "Resume" card was pressable _and_ contained the Resume button (react-native-web renders `role="button"` pressables as `<button>`). The card is no longer pressable. Exercise rows were already fine (row and ⓘ are siblings)
- **Check so it can't come back**: after every Jest test, `jest.after-env.ts` walks the rendered tree and fails the test if any pressable sits inside another (`test-utils/nesting.ts`). `__tests__/all-screens.test.tsx` opens every route so every screen gets checked
- **Max width on web**: `AppFrame` (web only) centers the app in a 600 px column with a border on wide screens; full width on phones
- **Real error causes**: `lib/errors.ts` maps errors to "No connection", "Database not set up – the server is missing the “exercises” table…", "Not allowed", "Session expired", or the server's own message, and shows the raw code underneath. Used by every error screen and every "couldn't save" message
- **Faster failures**: supabase-js retried each failed request 3 times and TanStack Query retried that 3 times (24 s before the offline message). supabase-js retries are now off; TanStack retries network errors once and never retries missing-table / permission / session errors (offline message in ~1 s)
- **Picker**: tap a row to select (circle fills), sticky "Add (N)" button always visible (disabled at 0), **recently used exercises in a "Recent" section at the top**

Verified in the dev server (where React prints nesting warnings) at 390 px and 1440 px: no console errors, chips 36 px tall with no overlap, column centered, missing-table and offline messages correct.

## Stage 3 – Templates and history

Built:

- **Database** (`20261031000000_templates_history.sql`):
  - `templates` + `template_exercises` (order, target sets, rep range or time, optional rest). `owner_id` null = ready-made. RLS: users read ready-made (not hidden) + their own; admins also see hidden ones. No direct inserts/updates: writes go through `save_template` (own) and `admin_save_template` / `admin_set_template_hidden` / `admin_delete_template` (admin check + `admin_actions` log). Both validate: 1–30 exercises, 1–20 sets, reps 1–100 with min ≤ max, and only exercises the owner may use
  - `template_from_workout(workout, name)`: copies a finished workout (exercises in order, working-set count, rep range done)
  - 8 ready-made templates: **Push / Pull / Legs**, **Upper / Lower**, **Full Body**, **5×5 A / B**
  - `workouts.template_id` (kept when editing, set to null if the template is deleted)
- **Server-only workout writes**: clients can now only _read_ `workouts` / `workout_sets`. `save_workout` (finish and edit) and `delete_workout` are the only write paths; they check ownership, recompute duration and volume, ignore any totals the app sends, reject future dates and other users' custom exercises, and call `after_workout_change()`. That function is a no-op today; Stage 4 (PRs) and Stage 8 (points) recompute there, so editing or deleting a past workout keeps them consistent
- **Workout tab**: workout in progress, Start empty, **My templates** and the ready-made programs, each with a **Start** button (one tap), recent workouts + History
- **Templates**: detail page (Start, Edit, Delete for yours; Copy for ready-made), editor with the same multi-select picker, sets −/+, rep range or time, move up/down, remove. Starting a template asks first if a workout is already running. Targets show as hints ("Target 4 × 6–8") and fill empty reps when you tick a set
- **Save a finished workout as a template** (from its summary page)
- **History** (`/history`): list grouped by month (loads 20 at a time), **Calendar** view (Monday first, dot on training days, tap a day to see its workouts, ← → months). Cells are flexible: 48 px at 390 px, 77×64 px in the 600 px web column
- **Edit a past workout**: name, date, start time, duration, sets (add / remove / change, add exercises). Same set UI as logging, without rest timer or "previous". Saved through `save_workout`, so the server recalculates. **Delete** with confirmation
- **Admin → Templates**: ready-made templates by program (hidden ones too), add, edit (incl. program and order), hide/show, delete, all logged

Refactor: the workout store is now one shared definition used by the live workout (persisted) and the edit screen (in memory), handed to the set UI through React context.

Checks: typecheck, lint, prettier, 147 Jest tests (incl. no-nested-pressables on every screen, new routes added to the smoke test), 115 DB checks. Web tested in the dev server at 390 px and 1440 px against a fake backend using the real seeded templates: start from template, finish, save as template, build a template with the picker, history list + calendar, edit (volume 800 kg and 1h 15m recomputed), delete, admin hide. No console errors.

### Decisions

- Dropped the direct write policies on `workouts` / `workout_sets` (Stage 2 allowed them). Otherwise a client could store its own volume and later points
- Ready-made templates can't be edited by users; "Copy to my templates" makes an editable copy
- Deleting a template keeps past workouts (link set to null). Hiding a ready-made template is reversible; deleting isn't
- Edit form uses plain text fields for date/time (YYYY-MM-DD, HH:MM) so it works the same on web and Android without a date-picker library
- The calendar groups by local date (a 23:30 workout belongs to that day)

### Fix after testing

- The Stage 3 migration failed when run a second time in the SQL Editor (`policy "workouts: own" does not exist`): its first statement had already run. The migration is now idempotent (every create/drop is guarded, the seed skips existing templates and no longer uses a temporary helper function). `npm run test:db` now re-runs it and also runs it after a simulated half-finished run; both end with exactly 8 ready-made templates. Future migrations follow the same rule (AGENTS.md)

### Known issues

- Reloading the page on the template editor or the edit-workout screen goes back (the draft is in memory). Finished workouts and templates are saved; only unsaved edits are lost
- Rep targets fill empty reps when you tick a set (like last time's values do); change them before ticking if you did fewer

## Planned for Stage 13 (polish)

- **Muscle map**: front and back SVG body diagram highlighting the muscles worked (primary darker, secondary lighter). Shown on exercise details, the workout summary, and the weekly overview on Home. Must work on web and native (react-native-svg)
