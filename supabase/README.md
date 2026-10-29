# Supabase

- `migrations/` – SQL migrations. Every table gets Row Level Security enabled in the same migration that creates it.
- `functions/` – Edge Functions (Deno). All Claude API calls and anything needing a secret key run here.

Setup (once):

```bash
npm i -g supabase
supabase login
supabase init        # creates config.toml, keep the existing folders
supabase link --project-ref <your-project-ref>
```

Apply migrations: `supabase db push`
Regenerate app types: `supabase gen types typescript --linked > types/database.ts`
