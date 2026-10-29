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
- **Web deploy moved forward** (from Stage 13, done after Stage 4): Cloudflare Pages, link + iPhone "Add to Home Screen" steps in docs/SETUP.md section 9.

## Stage status

| Stage | Name                                 | Status |
| ----- | ------------------------------------ | ------ |
| 0     | Project setup                        | Done   |
| 1     | Google login and onboarding          | Done   |
| 2     | Exercise library and workout logging | Done   |
| 3     | Templates and history                | Done   |
| 4     | Progress tracking                    | Done   |
| 5     | Offline mode and sync                | Done   |
| 6     | Claude feedback                      | Done   |
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
- ~~Stage 5 (offline on web): expo-sqlite on web needs extra HTTP headers (COOP/COEP)~~ Solved in Stage 5: web uses IndexedDB, no special headers
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

## Stage 4 – Progress tracking

Built:

- **Database** (`20261101000000_progress.sql`, idempotent):
  - `personal_records`: one row per user, exercise and record type (heaviest weight, best estimated 1RM, most reps at each weight, best session volume, longest hold/cardio), with the set and workout it came from and the previous best. Clients can only read their own rows
  - PRs are calculated on the server. `after_workout_change()` (called by `save_workout` and `delete_workout`) recalculates every exercise the workout had before and after the change, from all of the user's sets. Editing a set down or deleting the workout gives the previous best back its PR; removing an exercise from a workout does the same. Warm-up sets don't count; ties go to the earlier set
  - `workout_records(workout)`: the PRs a workout set that beat an earlier best. The celebration after Finish shows exactly this list, nothing is calculated in the app
  - `exercise_history`, `trained_exercises`, `weekly_overview` (workouts, volume, time, sets per muscle: primary = 1, secondary = 0.5)
  - `body_measurements` (one entry per day: bodyweight, body fat, 8 tape measurements, notes; realistic ranges checked). A trigger copies the newest bodyweight to `profiles.bodyweight_kg`, so logging bodyweight updates the profile. Existing profile bodyweights are copied in as a first entry
  - `progress_photos` + private storage bucket `progress-photos` (10 MB, JPEG/PNG/WebP). Storage policies only allow `<own user id>/...`; images are shown through signed URLs (1 h)
  - Existing workouts are backfilled into PRs when the migration runs
- **PR celebration** (`/workouts/celebrate`): after Finish, the app asks the server for the workout's new records. If there are any it shows them (trophy, "was 95 kg" → "100 kg"), then the summary; otherwise straight to the summary. The workout summary also lists its PRs
- **Exercise progress** (exercise page → Progress tab, or tap an exercise on the Progress tab): PR cards, most reps by weight, chart of top weight / est. 1RM / volume (or time / distance for cardio and holds) over 1M, 3M, 6M, 1Y or all, and the session list. Tap or drag across the chart to read a point
- **Body stats** (`/body`): log in kg or lbs / cm, chart per measurement, entries with edit and delete. Changing bodyweight in Edit profile also logs it for today
- **Progress photos** (`/photos`): timeline grouped by date, pose (front / side / back / other), full-screen viewer with delete, compare two photos side by side with the bodyweight closest to each date. Photos are resized to max 1600 px and saved as JPEG (quality 0.75) before upload. On web a single "Choose or take a photo" button opens the iPhone picker (Take Photo / Photo Library); on Android there are separate camera and library buttons
- **Progress tab**: latest bodyweight, photos, recent PRs, trained exercises
- **Home**: this week's workouts (Mon–Sun), volume, time and sets per muscle

Checks: typecheck, lint, prettier, 175 Jest tests, 159 DB checks (PRs over three workouts, ties, edit down, delete gives the previous best back, exercise removed by an edit, history and weekly overview, clients can't write PRs, profile bodyweight sync, photo folder isolation, private bucket). Android and iOS bundles export. Web tested at 390 px and 1440 px against a fake backend: finish a heavier bench → celebration with the server's record → summary, exercise chart (SVG, tap and drag), body log updating the profile, photo upload from a 3000×4000 1.1 MB JPEG → uploaded as 1200×1600, 148 KB. No console errors.

### Decisions

- **Charts: react-native-gifted-charts instead of victory-native.** victory-native draws with Skia; on web Skia needs CanvasKit, a 7 MB WebAssembly file (2.9 MB gzipped) that has to load before any chart shows, which is slow on an iPhone PWA over mobile data. gifted-charts draws with react-native-svg, which becomes plain SVG on web and native views on Android, with no extra download. Its own tap-to-focus doesn't work on web (it uses touch events SVG shapes don't get there), so the chart uses its own tap/drag layer instead
- Estimated 1RM uses the Epley formula and only sets of 1–12 reps (higher reps give unreliable estimates)
- "Most reps at a weight" counts per exact weight (e.g. 80 kg × 12). It's shown on the exercise page but not celebrated, otherwise almost every workout would show a celebration
- Only real improvements are celebrated: the first time you do an exercise sets records but doesn't show the trophy
- PRs are recalculated from all sets of the affected exercises, not adjusted step by step, so edits and deletes can't leave them out of sync
- One body entry per day; logging again the same day updates it. Deleting all entries keeps the last bodyweight on the profile
- Weekly overview on Home counts Monday–Sunday in the phone's time zone

### Known issues

- Photos are compressed in the app; a client could skip that and upload up to 10 MB (the bucket limit). Fine for two users
- ~~Signed photo URLs expire after 1 hour~~ (replaced by the photo lock: URLs live as long as the 5-minute unlock)
- The photo date is a text field (YYYY-MM-DD) like the edit-workout form; proper pickers are on the Stage 13 list

## After Stage 4 – photo lock, web deploy, lock file

Built:

- **Lock file fix**: `npm install` on npm 11 rewrote `package-lock.json` (npm 10 had written `"dev": true` on a few optional packages, npm 11 doesn't). The lock is now written by npm 11; `package.json` `engines` requires npm 11 and `.npmrc` has `engine-strict=true`, so npm 10 stops with a clear error instead of changing the file. `.nvmrc` = 24; EAS builds use Node 24.11.1 (npm 11)
- **Photo lock** (`20261102000000_photo_lock.sql`, `supabase/functions/photos`):
  - First visit to Progress photos asks for a 4–6 digit PIN or a password (your choice). Change, remove or set it in Profile → Photo lock
  - Stored only as a bcrypt hash (pgcrypto) in a table the app can't read. Not stored on the device
  - The right PIN gets a random unlock token (5 minutes, only its hash is stored). The app has **no direct access** to photo rows or files any more: policies and grants removed. The `photos` Edge Function lists, signs (URLs live at most as long as the unlock), uploads and deletes, and only after the database accepted the token for the signed-in user
  - Re-locks when you leave the photos section, when the app goes to the background (not while the camera/photo picker is open), after 5 minutes, on the lock button, or on sign-out. The photo list and its URLs are dropped from memory; on web photos are shown from in-memory `blob:` URLs and never cached; on Android the image cache is off for them
  - Locked state: Progress tab shows a lock icon and the count, no thumbnails; compare and the viewer are behind the same lock
  - 5 wrong attempts → 15 minutes locked, counted in the database (also for wrong biometric keys and for change/remove with a wrong current PIN)
  - Forgot PIN: sign in with Google again; the database only resets if the login token says Google (`amr` = oauth) within the last 10 minutes. Email code / magic link don't count. Resetting keeps the photos; you choose a new PIN. On web it continues after the Google redirect; if the Google account is a different LightweightBaby account it stops
  - Android: optional fingerprint/face unlock (expo-local-authentication). It's a separate random device key kept in the Android keystore behind biometrics (expo-secure-store `requireAuthentication`), not the PIN; removing or resetting the lock revokes it. Web: PIN/password only
- **Web deploy**: Cloudflare Pages, `npm run deploy:web` (export + wrangler upload), `public/_headers` (security headers, long caching for hashed files), step-by-step in docs/SETUP.md section 9, incl. Supabase/Google dashboard changes and iPhone steps. `npm run deploy:functions` deploys the Edge Function

Checks: typecheck, lint, prettier, 190 Jest tests (lock setup, wrong PIN counter and lockout, re-lock on leave / background / expiry / refused token, picker doesn't re-lock, locked compare, forgot PIN, biometrics, settings change/remove), 11 Edge Function tests (Deno: no or wrong / expired / other user's token → nothing listed, signed, uploaded or deleted; only JPEG ≤ 10 MB; orphan file removed), 226 DB checks (no direct access to own or others' rows/files, hashes, lockout, expiry, other user's token, reset needs fresh Google login, photos kept). Production web build served with the same headers, tested at 390 px and 1440 px: set PIN, upload (1.1 MB → 148 KB), photo shown from `blob:`, signed URL never in the page, re-lock on leaving and on hiding the page, wrong PIN message, still signed in after reopening. No console errors. Also ran once with COOP/COEP `require-corp` turned on (Chromium): everything still worked.

### Decisions

- **Host: Cloudflare Pages.** Free with unlimited bandwidth and no commercial-use limit; `_headers` applies to every response including JS files (COOP/COEP for Stage 5 must cover the SQLite worker script too); single-page fallback built in; one CLI command to deploy. EAS Hosting only applies custom headers to HTML/API responses, not static files. Vercel works too but its free plan is non-commercial only. Netlify's free plan now spends credits per deploy
- **COOP/COEP not set yet.** Nothing needs them before Stage 5, and iPhone Safari only supports `require-corp`, which blocks cross-origin images without CORS/CORP headers. Photos already avoid that (blob: URLs)
- The PIN is checked in the database (bcrypt), and the Edge Function checks the unlock token, instead of sending the PIN with every request
- Unlock is a fixed 5 minutes from unlocking (not extended by activity)
- Changing the PIN ends all unlocks but keeps biometric keys; removing the lock or resetting it drops them
- "Removed" (no lock) still goes through the Edge Function; it just needs no PIN

### Known issues / to check

- The Edge Function must be deployed (`npm run deploy:functions`) or photos show "The photos Edge Function isn't deployed yet"
- iPhone home-screen app: Google sign-in may come back to Safari instead of the app; email code works. Forgot PIN needs Google: if it doesn't work inside the home-screen app, do the reset in Safari (it's stored on the server), then open the app and set the new PIN
- Biometric unlock is untested on a real phone (needs a new Android build: `npx eas-cli@latest build --profile preview --platform android`)
- The "fresh Google login" check relies on Supabase putting `amr: [{method: "oauth", timestamp}]` in the token (true for both the web redirect and Android ID-token sign-in, per Supabase Auth source)

## Stage 5 – Offline mode and sync

Built:

- **Storage: IndexedDB on web, SQLite on Android, one interface** (`lib/offline/storage.ts` / `.web.ts`, a small key-value store). It holds the query cache and the sync queue
- **Server** (`20261104000000_offline_sync.sql`, idempotent):
  - `client_updated_at` on workouts and templates: when the change was made on the device. Last write wins compares that (capped at server time so a wrong phone clock can't win forever), not `updated_at` (the time it arrived)
  - `sync_tombstones`: deleting leaves a tombstone, so an older offline edit arriving later can't bring a workout/template back; a newer edit can
  - `save_workout` v4 (same checks and server-side totals/PRs as before, plus last-write-wins), `delete_workout_at(id, time)` (`delete_workout(id)` still works), `save_template` takes the app's id for new templates, new `delete_template(id, time)`. Retries with the same ids never create duplicates; deleting twice is fine
- **Sync queue** (`lib/offline/outbox.ts`, `sync.ts`): saves are stored on the device first, then sent through the same server functions. Covers finishing/editing/deleting workouts, creating/editing/deleting templates (incl. "Save as template", now built on the device), custom exercises (app-picked id, upsert) and rest times
  - A newer save of the same thing replaces a waiting one; a delete drops waiting saves
  - Sent when the app opens, when the connection comes back, when the app returns to the front, and every minute while something waits; one run at a time, in order
  - No connection / expired session / server 5xx → stays and is retried. Refused by the server (deleted exercise, invalid data, not allowed) → marked "Couldn't sync", shown on the Sync screen with the reason, Retry or Discard; never retried forever or dropped silently. Unknown errors become a problem after 5 tries
  - Each account has its own queue (stored under its id); a queue is only ever sent with that account's session. A workout in progress from another account is discarded, never saved into this one. Logging out with unsynced changes asks first (they stay for that account)
- **Offline reading:** the query cache is saved on the device per user (thrown away on sign-out or another account) and restored on start. While online the app pre-loads what the gym needs: exercise library, templates, recent workouts and first history page, rest times, and last time's sets for recent and template exercises (now cached per exercise). Queued changes show on top: history, calendar, recent list, Home week stats, workout details, templates, exercises. Rows say "Waiting to sync" / "Couldn't sync"
- **Opens offline** even with an expired login token: the app starts with the session stored on the device (Supabase keeps retrying the refresh for ~30 s offline) and refreshes it when back online. Logging out works offline (this device only)
- **Service worker** (web, production builds only; `scripts/build-sw.mjs` generates `dist/sw.js` after `expo export`): precaches the app (HTML, JS, fonts, icons; 64 files, 2.7 MB). Only same-origin files of this app; never Supabase API, Edge Functions, storage or Google. A new deploy installs in the background → "Update available, tap to reload" banner → tap → new version. Checks for updates when the app comes to the front and every 30 minutes
- **Indicators:** "Offline · 2 changes waiting to sync" / "1 couldn't sync" in the tab headers (tap → Sync screen). Loading screens say "No connection. This loads when you're back online."
- **Online only, with a clear "Needs connection" state:** progress photos (server PIN lock), photo lock settings, admin tools, logging body stats. AI features later

Checks: typecheck, lint, prettier, 224 Jest tests (queue merging, per-account queues, retry vs. permanent failure, failed item shown with Retry/Discard, order kept, other account's session never used, overlays, offline finish → waiting → synced once, logout warning, needs-connection states, another account's workout in progress), 11 Edge Function tests, 263 DB checks (retries store once, older edit ignored, newer wins, delete vs. edit by time, tombstones, future clock capped, others can't overwrite/delete, template ids). Android and iOS bundles export.

Airplane-mode test on the production web build with the service worker, at 390 px and 1440 px, with every request to Supabase refused while offline: sign in → go offline → start, log and finish a workout (saved on the device, Home counts it, "Offline · 1 change waiting to sync") → photos say "Needs connection" → wait until the login token expired → close and reopen offline (app loads from the service worker, still signed in, workout in history) → back online → synced automatically, **exactly one** `save_workout` call and one workout on the server, still one after a reload → simulated new deploy → banner → tap → new version. Only app files in the cache. No console errors. The Stage 4 photo-lock browser test still passes with the service worker on.

### Decisions

- **IndexedDB on web instead of SQLite.** SQLite on web needs cross-origin isolation; iPhone Safari only supports the strict `COEP: require-corp`, which blocks cross-origin images that don't opt in (Google profile pictures, Supabase avatars) and adds a 1 MB+ WebAssembly download; Expo also marks SQLite on web as alpha. IndexedDB works in Safari and home-screen apps without any headers. Android keeps SQLite. Both sit behind one small interface, and what's stored (a cache and a queue) doesn't need SQL queries
- The cache + queue approach (TanStack Query persisted cache, queue of server-function calls) instead of a full local database copy: the server stays the only place totals, PRs and (later) points are calculated
- Photos stay online-only: their URLs come from the server only after the PIN, so they can't be cached for offline
- Finish online still shows the PR celebration from the server; offline it goes to the summary ("records are checked when it syncs")
- Mutations always run (even offline): queued ones save to the device; online-only ones fail fast with "No connection" instead of hanging

### Known issues / to check

- Android needs a new build for the new native modules (expo-sqlite, expo-network; expo-local-authentication from the photo lock): `npx eas-cli@latest build --profile preview --platform android`
- A brand-new install that has never been online can't show anything offline (nothing cached yet)
- Records (PRs) for an offline workout appear after it syncs; no celebration afterwards
- If you edit the same workout on two devices while both are offline, the later edit (by device time) wins as a whole; changes aren't merged set by set

## Stage 6 – Claude feedback (post-workout and weekly)

Built:

- **Model and cost:** Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50 per million input / output tokens, cache reads $0.01, 5-minute cache writes $0.125; checked on the Anthropic pricing page 2026-10-29) for everything, Stage 7 included. The model ID and prices are one row in `ai_settings`, changeable from Admin → AI. No thinking, low effort, structured JSON output; max 400 output tokens for workout feedback, 700 for the weekly report. The fixed system prompt (~870 tokens, above Haiku's 512-token caching minimum, no dates or user data in it) is cached. Claude gets a compact summary built in SQL (`ai_workout_context`, `ai_week_context`: per exercise working sets, top set, best e1RM, volume; up to 3 previous sessions of each exercise; PRs set; sets per muscle this week; 4 previous weeks' totals; goal, experience, planned days; notes for pain mentions; weights in the user's unit; no ids), never raw rows: under ~3,000 characters, so a call is about 1,500-2,000 input tokens. Every call logged in `ai_usage` with input, output, cache write/read tokens, attempts and cost
- **Limits, enforced in the database before Claude is called** (`ai_reserve`, one lock, so a double tap or two users at the cap can't both get through): kill switch, daily limit (default 3; admin per-user overrides), global daily spending cap (default $0.50). A running call counts; a failed call doesn't use up a request; weekly reports don't use the user's daily requests. Blocked attempts are logged too
- **Edge Functions** (`workout-feedback`, `weekly-report`, shared code in `supabase/functions/_shared`): check the user with Supabase Auth, return saved feedback without a call, reserve, build the summary, call Claude (Anthropic TypeScript SDK, 25 s timeout, one retry for overloaded/5xx), validate the JSON (lengths and item counts the schema can't express; cut-off or refused answers count as invalid), ask once more if invalid, then a clean error. Saved in `ai_feedback`. Clear messages for limit, kill switch, cap, timeout, API errors, already running
- **Feedback content:** compares with previous sessions of the same exercises (numbers), names PRs, checks weekly muscle balance, flags volume jumps (~30%+) or back-to-back hard days only when the data shows them, one or two concrete targets; no generic motivation; no diagnoses: if notes mention pain or injury, `see_professional` is set and the app shows "stop the movement that hurts and see a physiotherapist or doctor"
- **App:** "Get AI feedback" card on the workout summary (not automatic), with "2 of 3 AI requests left today"; saved feedback reopens for free (also offline); "Get new feedback" only after the workout was edited. Offline: "Needs connection". Logged offline and not synced yet: "available once this workout has synced". AI off / paused for the day / limit reached say so
- **Weekly reports:** pg_cron Mondays 06:15 UTC (Tue/Wed catch-up for anyone skipped by the cap or kill switch) → `ai_start_weekly_run()` → `weekly-report` (one-time token, no secret) → a report for each user who trained last week. Weekly reports screen (Progress tab), "New weekly report" card on Home until opened, Android push via Expo (tap opens the report). Admin "Generate my report now" (current week, for testing)
- **Admin → AI:** kill switch, daily limit, spending cap, model ID, max tokens, per-user overrides (search by name or email), spent today, last 30 days: calls, cost, errors and error rate, blocked, tokens, calls and cost per day charts, top users. Every change logged in `admin_actions` with the value before

Checks: typecheck, lint, prettier, 242 Jest tests (feedback only on tap, saved feedback free, 4th request blocked with the message, server refusal shown, offline "Needs connection", AI off, see-a-professional banner, weekly badge until opened, admin kill switch / limits / override / dashboard / generate now, non-admins kept out), 27 Edge Function tests with Claude faked (feedback saved and logged with tokens, reopen without a call, **4th request blocked before Claude is called**, kill switch, invalid → retried once → accepted, invalid twice → clean error and not counted, cut-off/refused answers, timeout and API errors, double tap, unsynced workout, cron token once, cap and kill switch stop the Monday run, push sent and dead tokens removed, admin-only generate), DB checks for limits, overrides, kill switch, cap, cost arithmetic, admin logging, users only see their own, the summary content (previous sessions, PRs, muscles, notes, lbs, compact, no ids), weekly candidates, cron token, push tokens. Browser test of the production build at 390 px and 1440 px with the functions faked: 3 feedbacks, the 4th blocked, reopening free, weekly report badge until opened, admin screen. No real Claude calls in any automated test.

### Decisions

- **iPhone: in-app "New weekly report" card, not web push.** Web push works for home-screen apps on iOS 16.4+, but it needs a separate permission prompt from a button tap inside the installed app, signed VAPID pushes from the server, and subscriptions that iOS can silently drop (after updates, storage cleanup or long inactivity) with no way to tell. For a once-a-week report the card on Home is reliable; web push can be added later
- Android push through Expo's push service (no extra secret); needs FCM credentials in EAS and a new APK
- Everything that costs money is checked on the server; the app only shows what the server says
- Thinking off and low effort: these are short structured answers from pre-computed numbers, and thinking tokens would count against the 400/700 cap
- The admin test button reports the current week (last week may have no workouts on a test day); the Monday job reports the finished week

### Known issues / to check

- Android push needs the FCM setup in docs/SETUP.md section 11 and a new build; until then Android shows the in-app card
- pg_cron and pg_net must be turned on before running the migration (it warns if not)
- Feedback for a workout logged offline appears only after it synced
- Exact token counts per call are in `ai_usage`; check the first real calls (see the live check in the Stage 6 report)

## Planned for Stage 13 (polish)

- **Muscle map**: front and back SVG body diagram highlighting the muscles worked (primary darker, secondary lighter). Shown on exercise details, the workout summary, and the weekly overview on Home. Must work on web and native (react-native-svg)
- **Date/time pickers** in the edit-workout form (and the body / photo date fields): native `<input type="date">` / `type="time"` on web, the native picker on Android
- **Drafts survive a reload**: unsaved changes in the template editor and the edit-workout screen are kept when the page is reloaded
