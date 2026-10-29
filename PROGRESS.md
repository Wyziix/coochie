# Progress

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

### Known issues

- Not run on real iOS/Android simulators yet (none available in the build environment). Native bundles compile; first simulator run is on you
- `expo-doctor`: 18/20 checks pass, the 2 failing ones need the Expo API, which was blocked in the build environment. Re-run locally
- No iOS bundle identifier / Android package name set yet. Needed for Google Sign-In in Stage 1
