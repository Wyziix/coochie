import { fireEvent, render, screen } from '@testing-library/react-native';

import { Input } from '@/components/ui';

describe('Input', () => {
  it('shows label and error', async () => {
    await render(<Input label="Username" error="Already taken" />);
    expect(screen.getByText('Username')).toBeOnTheScreen();
    expect(screen.getByText('Already taken')).toBeOnTheScreen();
  });

  it('passes text changes through', async () => {
    const onChangeText = jest.fn();
    await render(<Input label="Username" onChangeText={onChangeText} />);
    await fireEvent.changeText(screen.getByLabelText('Username'), 'gleb');
    expect(onChangeText).toHaveBeenCalledWith('gleb');
  });
});
