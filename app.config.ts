import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json holds the static config; this file adds the parts that depend on env vars.
export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];

  // Native Google sign-in on iOS needs the reversed iOS client ID as a URL scheme.
  // iPhone users use the web app for now, so this is only added when the iOS
  // client ID is set. Android needs no plugin config.
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (iosClientId) {
    const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`;
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }

  return {
    ...config,
    name: config.name ?? 'LightweightBaby',
    slug: config.slug ?? 'lightweightbaby',
    plugins,
  };
};
