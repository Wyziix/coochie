/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: [
    './jest.setup.tsx',
    '<rootDir>/node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js',
  ],
  setupFilesAfterEnv: ['./jest.after-env.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/supabase/'],
  collectCoverageFrom: [
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'stores/**/*.ts',
    'hooks/**/*.ts',
  ],
};
