import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import path from 'path';

const appDir = path.resolve(__dirname, '../app');

describe('tab navigation', () => {
  it('opens on Home and switches between all tabs', async () => {
    await renderRouter(appDir, { initialUrl: '/' });
    expect(screen).toHavePathname('/');

    const tabs = [
      { label: 'Workout', path: '/workout' },
      { label: 'Progress', path: '/progress' },
      { label: 'Ranking', path: '/ranking' },
      { label: 'Profile', path: '/profile' },
      { label: 'Home', path: '/' },
    ];

    for (const tab of tabs) {
      await fireEvent.press(screen.getByRole('button', { name: new RegExp(tab.label) }));
      expect(screen).toHavePathname(tab.path);
    }
  });
});
