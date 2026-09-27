import { describe, expect, it } from 'vitest';
import {
  DEPTH_MAP_ELIGIBILITY_THRESHOLD,
  isDepthMapEligible,
} from './depth-eligibility';

describe('depth-map eligibility', () => {
  it('uses the calibrated named threshold', () => {
    expect(DEPTH_MAP_ELIGIBILITY_THRESHOLD).toBe(0.94);
    expect(isDepthMapEligible(DEPTH_MAP_ELIGIBILITY_THRESHOLD - 0.0001)).toBe(false);
    expect(isDepthMapEligible(DEPTH_MAP_ELIGIBILITY_THRESHOLD)).toBe(true);
  });

  it('rejects non-finite scores', () => {
    expect(isDepthMapEligible(Number.NaN)).toBe(false);
    expect(isDepthMapEligible(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
