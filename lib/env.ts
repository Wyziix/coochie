// Only EXPO_PUBLIC_* values are bundled into the app. Never put secret keys here:
// the Claude API key, Supabase service role key and webhook secrets live in
// Supabase Edge Function secrets (see supabase/functions/.env.example).
// Expo inlines process.env.EXPO_PUBLIC_* at build time, so each one must be
// read with a static property access.
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
} as const;

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabasePublishableKey);
