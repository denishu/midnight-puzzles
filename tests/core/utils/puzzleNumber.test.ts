import { puzzleNumber, PUZZLE_EPOCH_UTC } from '../../../core/utils/puzzleNumber';

describe('puzzleNumber', () => {
  it('epoch date (2026-10-01 UTC) is #1', () => {
    expect(puzzleNumber(new Date('2026-10-01T00:00:00Z'))).toBe(1);
    expect(puzzleNumber(new Date('2026-10-01T23:59:59Z'))).toBe(1);
  });

  it('increments by one per UTC day', () => {
    expect(puzzleNumber(new Date('2026-10-02T00:00:00Z'))).toBe(2);
    expect(puzzleNumber(new Date('2026-10-10T12:00:00Z'))).toBe(10);
  });

  it('keeps climbing across a year boundary (does not reset annually)', () => {
    // 2026 has 92 days from Oct 1 to Dec 31 inclusive; 2027-10-01 is a full year on.
    expect(puzzleNumber(new Date('2027-10-01T00:00:00Z'))).toBe(366);
    expect(puzzleNumber(new Date('2027-10-01T00:00:00Z')))
      .not.toBe(puzzleNumber(new Date('2026-10-01T00:00:00Z')));
  });

  it('uses the UTC calendar date, not local time', () => {
    // 2026-10-05 20:00 in UTC-10 (Hawaii) is still 2026-10-06 06:00 UTC -> #6, not #5.
    const hawaiiEvening = new Date('2026-10-06T06:00:00Z');
    expect(puzzleNumber(hawaiiEvening)).toBe(6);
  });

  it('clamps dates before the epoch to #1', () => {
    expect(puzzleNumber(new Date('2026-09-30T00:00:00Z'))).toBe(1);
    expect(puzzleNumber(new Date('2020-01-01T00:00:00Z'))).toBe(1);
  });

  it('accepts a custom epoch', () => {
    const epoch = Date.UTC(2020, 0, 1); // 2020-01-01
    expect(puzzleNumber(new Date('2020-01-01T00:00:00Z'), epoch)).toBe(1);
    expect(puzzleNumber(new Date('2020-01-03T00:00:00Z'), epoch)).toBe(3);
  });

  it('exports the expected epoch constant', () => {
    expect(PUZZLE_EPOCH_UTC).toBe(Date.UTC(2026, 9, 1));
  });
});
