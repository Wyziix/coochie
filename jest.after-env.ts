import { cleanup, screen } from '@testing-library/react-native';

import { findNestedPressables } from '@/test-utils/nesting';

// Auto-cleanup is off (RNTL_SKIP_AUTO_CLEANUP in jest.setup.tsx) so this runs
// on the final screen of every test before unmounting: no pressable may sit
// inside another pressable (invalid nested <button> on web).
afterEach(async () => {
  let problems: string[] = [];
  try {
    problems = findNestedPressables(screen.root as never);
  } catch {
    // Nothing rendered in this test.
  }
  await cleanup();
  if (problems.length > 0) {
    throw new Error(`Nested pressables (invalid on web):\n  ${problems.join('\n  ')}`);
  }
});
