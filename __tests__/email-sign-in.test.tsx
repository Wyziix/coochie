import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { EmailSignIn } from '@/components/auth/EmailSignIn';
import { sendEmailCode, verifyEmailCode } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth/email'),
  sendEmailCode: jest.fn(async () => {}),
  verifyEmailCode: jest.fn(async () => {}),
}));

describe('EmailSignIn', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a code, then verifies it', async () => {
    await render(<EmailSignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Gleb@Example.com ');
    await fireEvent.press(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    expect(sendEmailCode).toHaveBeenCalledWith(' Gleb@Example.com ');

    expect(await screen.findByText(/We sent a code to gleb@example.com/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Sign-in code'), '12 34 56');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(verifyEmailCode).toHaveBeenCalledWith('gleb@example.com', '123456');
  });

  it('rejects an invalid email without sending', async () => {
    await render(<EmailSignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeOnTheScreen());
    expect(sendEmailCode).not.toHaveBeenCalled();
  });

  it('shows server errors (e.g. wrong code)', async () => {
    jest
      .mocked(verifyEmailCode)
      .mockRejectedValueOnce(new Error('That code is wrong or has expired.'));
    await render(<EmailSignIn />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.co');
    await fireEvent.press(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    await fireEvent.changeText(await screen.findByLabelText('Sign-in code'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('That code is wrong or has expired.')).toBeOnTheScreen();
  });
});
