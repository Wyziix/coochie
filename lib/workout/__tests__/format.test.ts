import {
  defaultWorkoutName,
  displayToMeters,
  formatDuration,
  formatDurationShort,
  metersToDisplay,
  parseDuration,
} from '@/lib/workout/format';

describe('durations', () => {
  it('formats', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDurationShort(42 * 60)).toBe('42m');
    expect(formatDurationShort(65 * 60)).toBe('1h 05m');
  });

  it('parses m:ss, h:mm:ss and bare numbers in the given unit', () => {
    expect(parseDuration('1:30', 'seconds')).toBe(90);
    expect(parseDuration('1:02:00', 'minutes')).toBe(3720);
    expect(parseDuration('45', 'seconds')).toBe(45);
    expect(parseDuration('25', 'minutes')).toBe(1500);
    expect(parseDuration('2,5', 'minutes')).toBe(150);
    expect(parseDuration('', 'seconds')).toBeNull();
    expect(parseDuration('abc', 'seconds')).toBeNull();
  });
});

describe('distance', () => {
  it('uses km for kg users and miles for lbs users', () => {
    expect(metersToDisplay(5000, 'kg')).toBe(5);
    expect(metersToDisplay(1609.344, 'lbs')).toBe(1);
    expect(displayToMeters(3.1, 'lbs')).toBe(4989);
  });
});

describe('defaultWorkoutName', () => {
  it('names by time of day', () => {
    expect(defaultWorkoutName(new Date(2026, 0, 1, 7))).toBe('Morning workout');
    expect(defaultWorkoutName(new Date(2026, 0, 1, 14))).toBe('Afternoon workout');
    expect(defaultWorkoutName(new Date(2026, 0, 1, 19))).toBe('Evening workout');
  });
});
