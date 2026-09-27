import { describe, expect, it } from 'vitest';
import { formatVietnameseNumber, odometerColumnOffset } from './number-format';

describe('formatVietnameseNumber', () => {
  it('formats integers, grouping, and decimals Vietnamese style', () => {
    expect(formatVietnameseNumber(30, 0, false)).toBe('30');
    expect(formatVietnameseNumber(1000, 0, true)).toBe('1.000');
    expect(formatVietnameseNumber(1234567, 0, true)).toBe('1.234.567');
    expect(formatVietnameseNumber(1.5, 1, false)).toBe('1,5');
    expect(formatVietnameseNumber(12.345, 1, false)).toBe('12,3');
  });
});

describe('odometerColumnOffset', () => {
  it('rolls the units column continuously and carries higher columns only from 9', () => {
    expect(odometerColumnOffset(1975, 0)).toBe(5);
    expect(odometerColumnOffset(1975, 1)).toBe(7);
    expect(odometerColumnOffset(1975.5, 0)).toBeCloseTo(5.5);
    expect(odometerColumnOffset(1975.5, 1)).toBe(7);
    expect(odometerColumnOffset(1979.5, 1)).toBeCloseTo(7.5);
    expect(odometerColumnOffset(1999.5, 2)).toBeCloseTo(9.5);
    expect(odometerColumnOffset(2012, 3)).toBe(2);
  });
});
