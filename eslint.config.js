// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  prettierRecommended,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      'node_modules/*',
      'supabase/functions/*',
      'coverage/*',
      // Plain service-worker script, not part of the app bundle.
      'scripts/sw.template.js',
    ],
  },
  {
    rules: {
      'import/no-duplicates': 'error',
      'react/self-closing-comp': 'warn',
    },
  },
]);
