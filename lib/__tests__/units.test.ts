import {
  formatHeight,
  formatWeight,
  fromDisplayHeight,
  fromDisplayWeight,
  kgToLbs,
  lbsToKg,
  toDisplayHeight,
  toDisplayWeight,
} from '@/lib/units';

describe('units', () => {
  it('converts kg and lbs both ways', () => {
    expect(kgToLbs(100)).toBeCloseTo(220.462, 3);
    expect(lbsToKg(225)).toBeCloseTo(102.058, 3);
    expect(lbsToKg(kgToLbs(87.5))).toBeCloseTo(87.5, 10);
  });

  it('stores display weight as kg', () => {
    expect(fromDisplayWeight(80, 'kg')).toBe(80);
    expect(fromDisplayWeight(176, 'lbs')).toBe(79.83);
  });

  it('shows stored kg in the chosen unit', () => {
    expect(toDisplayWeight(80, 'kg')).toBe(80);
    expect(toDisplayWeight(80, 'lbs')).toBe(176.4);
    expect(formatWeight(100, 'lbs')).toBe('220.5 lbs');
  });

  it('handles height in cm and inches', () => {
    expect(fromDisplayHeight(70, 'lbs')).toBe(177.8);
    expect(toDisplayHeight(180, 'lbs')).toBe(70.9);
    expect(toDisplayHeight(180.4, 'kg')).toBe(180);
    expect(formatHeight(180, 'kg')).toBe('180 cm');
    expect(formatHeight(180, 'lbs')).toBe('5\'11"');
  });
});
