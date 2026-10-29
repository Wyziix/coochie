import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/components/ui';

describe('Button', () => {
  it('renders the title and handles presses', async () => {
    const onPress = jest.fn();
    await render(<Button title="Start workout" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows a spinner instead of the title while loading', async () => {
    await render(<Button title="Save" loading />);
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
