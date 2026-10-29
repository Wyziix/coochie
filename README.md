# Gym App

Gym tracking app built with Expo (React Native), Expo Router and Supabase.

## Setup

```bash
npm install
cp .env.example .env   # fill in Supabase URL + publishable key
npm start              # then press i (iOS simulator) or a (Android emulator)
```

The app runs without Supabase keys for now; the Profile tab shows whether they're set.

## Scripts

| Command             | What it does                             |
| ------------------- | ---------------------------------------- |
| `npm start`         | Expo dev server                          |
| `npm run ios`       | Open in iOS simulator                    |
| `npm run android`   | Open in Android emulator                 |
| `npm run typecheck` | TypeScript                               |
| `npm run lint`      | ESLint (with Prettier rules)             |
| `npm run format`    | Prettier write                           |
| `npm test`          | Jest                                     |
| `npm run check`     | All of the above checks, used pre-commit |

## Structure

```
app/          screens (Expo Router). (tabs)/ holds the 5 bottom tabs
components/   ui/ = reusable primitives, providers/ = app-wide providers
lib/          supabase client, env, query client, theme tokens
stores/       Zustand stores
hooks/        shared hooks (useTheme, ...)
types/        shared types (Supabase generated types go in database.ts)
supabase/     migrations/ and functions/ (Edge Functions)
__tests__/    integration tests (routing). Unit tests sit next to code in __tests__/ folders
```

See `PROGRESS.md` for stage status and decisions.
