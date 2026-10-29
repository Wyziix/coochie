import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState, LoadingState } from '@/components/ui';

describe('EmptyState', () => {
  it('renders title, message and action', async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState
        title="No workouts"
        message="Start one"
        actionLabel="Start"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('No workouts')).toBeOnTheScreen();
    expect(screen.getByText('Start one')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe('LoadingState', () => {
  it('has an accessible label', async () => {
    await render(<LoadingState message="Loading workouts" />);
    expect(screen.getByLabelText('Loading workouts')).toBeOnTheScreen();
  });
});
