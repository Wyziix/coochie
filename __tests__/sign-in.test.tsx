import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';
import { signInWithGoogle } from '@/lib/auth';

jest.mock('@/lib/env', () => require('@/test-utils/backend').envMock);
jest.mock('@/lib/auth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const mockedSignIn = jest.mocked(signInWithGoogle);

describe('SignInScreen', () => {
  it('starts Google sign-in', async () => {
    mockedSignIn.mockResolvedValueOnce('signed-in');
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(mockedSignIn).toHaveBeenCalled();
  });

  it('shows the error when sign-in fails', async () => {
    mockedSignIn.mockRejectedValueOnce(
      new Error('Google Play Services is missing or out of date.'),
    );
    await render(<SignInScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() =>
      expect(screen.getByText('Google Play Services is missing or out of date.')).toBeOnTheScreen(),
    );
  });
});
