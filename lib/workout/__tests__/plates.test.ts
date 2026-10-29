import { calculatePlates, PLATES } from '@/lib/workout/plates';

describe('calculatePlates', () => {
  it('splits kg plates per side', () => {
    expect(calculatePlates(100, 20, PLATES.kg)).toEqual({
      ok: true,
      perSide: [
        { plate: 25, count: 1 },
        { plate: 15, count: 1 },
      ],
      loaded: 100,
      remainder: 0,
    });
  });

  it('handles fractional plates without float drift', () => {
    const r = calculatePlates(62.5, 20, PLATES.kg);
    expect(r).toMatchObject({ ok: true, loaded: 62.5, remainder: 0 });
    if (r.ok)
      expect(r.perSide).toEqual([
        { plate: 20, count: 1 },
        { plate: 1.25, count: 1 },
      ]);
  });

  it('works in lbs', () => {
    const r = calculatePlates(225, 45, PLATES.lbs);
    expect(r).toMatchObject({ ok: true, perSide: [{ plate: 45, count: 2 }], remainder: 0 });
  });

  it('reports the closest weight when the target can’t be hit', () => {
    expect(calculatePlates(101, 20, PLATES.kg)).toMatchObject({
      ok: true,
      loaded: 100,
      remainder: 1,
    });
  });

  it('just the bar', () => {
    expect(calculatePlates(20, 20, PLATES.kg)).toMatchObject({ ok: true, perSide: [], loaded: 20 });
  });

  it('rejects targets under the bar or empty', () => {
    expect(calculatePlates(15, 20, PLATES.kg)).toEqual({
      ok: false,
      error: 'Target is lighter than the bar',
    });
    expect(calculatePlates(0, 20, PLATES.kg).ok).toBe(false);
  });
});
