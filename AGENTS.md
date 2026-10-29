This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `app/` (project root) — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `app/`, and never put test files inside `app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## This project

- Build plan and stage status: `PROGRESS.md`. Work one stage at a time.
- Run `npm run check` (typecheck, lint, prettier, jest) before every commit.
- No secrets in app code. Only `EXPO_PUBLIC_*` env vars reach the app; server secrets live in Supabase Edge Function secrets.
- UI: use `useTheme()` and the components in `components/ui`; no hard-coded colors in screens.
- Migrations must be safe to run twice (`if not exists`, `drop ... if exists` before `create policy/trigger`, seeds that skip existing rows, no `pg_temp` helpers) and say `idempotent` in their first 5 lines; `npm run test:db` re-runs them and also runs them after a half-finished run. If a newer migration removes access an older one grants (policies, grants), guard the older one so re-running it can't bring the access back.
- Every Supabase table has RLS enabled in the migration that creates it. Add cases to `supabase/tests/*.test.sql` and run `npm run test:db`.
- Web is a first-class target (iPhone users use the PWA). Every feature must work on web or be hidden/disabled cleanly there; never crash on web. Use `.web.ts` files for platform-specific code, and don't use `Alert.alert` directly (use `lib/confirm.ts`). Use `aria-*` props (`aria-checked`, `aria-disabled`, ...) instead of `accessibilityState`, which react-native-web ignores.
- Never put a pressable inside another pressable (it becomes `<button>` in `<button>` on web). Make them siblings. Jest fails any test that renders this; add new routes to `__tests__/all-screens.test.tsx`.
- Show errors with `ErrorState error={error}` / `describeError()` so the real cause (offline, missing table, permission) is visible.
- Horizontal chip/filter rows use `ChipRow` (fixed height, never shrinks).
