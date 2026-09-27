/** Calibrated against all 30 Kodak image scenes on 2026-09-27. */
export const DEPTH_MAP_ELIGIBILITY_THRESHOLD = 0.94;

export function isDepthMapEligible(score: number): boolean {
  return Number.isFinite(score) && score >= DEPTH_MAP_ELIGIBILITY_THRESHOLD;
}
