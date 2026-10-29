import { act, render } from '@testing-library/react-native';

import { RestTimerWatcher } from '@/components/workout/RestTimerWatcher';
import { restDoneAlert } from '@/lib/platform/feedback';
import { useWorkoutStore } from '@/stores/workoutStore';

jest.mock('@/lib/platform/feedback', () => ({ restDoneAlert: jest.fn() }));

describe('RestTimerWatcher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(restDoneAlert).mockClear();
    useWorkoutStore.setState({ restTimer: null });
  });
  afterEach(() => jest.useRealTimers());

  it('alerts in-app when the rest ends and clears the timer', async () => {
    await render(<RestTimerWatcher />);
    await act(() => useWorkoutStore.getState().startRest('ex', 60, null));
    await act(() => jest.advanceTimersByTime(59_000));
    expect(restDoneAlert).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1_500));
    expect(restDoneAlert).toHaveBeenCalledTimes(1);
    expect(useWorkoutStore.getState().restTimer).toBeNull();
  });

  it('clears a timer that ended while the app was closed, without alerting', async () => {
    useWorkoutStore.setState({
      restTimer: {
        endsAt: Date.now() - 60_000,
        totalSeconds: 90,
        exerciseKey: 'ex',
        notificationId: null,
      },
    });
    await render(<RestTimerWatcher />);
    expect(useWorkoutStore.getState().restTimer).toBeNull();
    expect(restDoneAlert).not.toHaveBeenCalled();
  });
});
