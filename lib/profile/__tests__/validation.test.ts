import { parseBodyweight, parseHeight, validateUsername } from '@/lib/profile/validation';

describe('validateUsername', () => {
  it.each(['gleb', 'gleb_lifts', 'abc', 'a1234567890123456789'])('accepts %s', (name) => {
    expect(validateUsername(name)).toBeNull();
  });

  it('normalizes case and whitespace before checking', () => {
    expect(validateUsername('  Gleb ')).toBeNull();
  });

  it.each([
    ['ab', 'At least 3 characters'],
    ['a12345678901234567890', 'At most 20 characters'],
    ['gleb.k', 'Only letters, numbers and _'],
    ['gl eb', 'Only letters, numbers and _'],
    ['глеб', 'Only letters, numbers and _'],
  ])('rejects %s', (name, message) => {
    expect(validateUsername(name)).toBe(message);
  });
});

describe('parseBodyweight', () => {
  it('returns kg for kg and lbs input', () => {
    expect(parseBodyweight('80', 'kg')).toEqual({ value: 80, error: null });
    expect(parseBodyweight('80,5', 'kg')).toEqual({ value: 80.5, error: null });
    expect(parseBodyweight('176', 'lbs')).toEqual({ value: 79.83, error: null });
  });

  it('rejects empty, junk and unrealistic values', () => {
    expect(parseBodyweight('', 'kg').error).toBe('Enter a number');
    expect(parseBodyweight('abc', 'kg').error).toBe('Enter a number');
    expect(parseBodyweight('10', 'kg').error).toBeTruthy();
    expect(parseBodyweight('900', 'lbs').error).toBeTruthy();
  });
});

describe('parseHeight', () => {
  it('is optional', () => {
    expect(parseHeight('', 'kg')).toEqual({ value: null, error: null });
  });

  it('parses cm and inches to cm', () => {
    expect(parseHeight('180', 'kg')).toEqual({ value: 180, error: null });
    expect(parseHeight('70', 'lbs')).toEqual({ value: 177.8, error: null });
  });

  it('rejects unrealistic heights', () => {
    expect(parseHeight('18', 'kg').error).toBeTruthy();
  });
});
