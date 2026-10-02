import type { ScriptPresetId } from '../../../../../contracts/project.js';

export const SCRIPT_PRESET_CONFIG: Record<ScriptPresetId, { actWeighting: number[] | null; weightingStrictness: 'strict' | 'soft' | 'none' }> = {
  documentary: { actWeighting: [8, 15, 55, 12, 10], weightingStrictness: 'soft' },
  'hubris-trap': { actWeighting: [8, 15, 55, 12, 10], weightingStrictness: 'strict' },
  // These five values map to 0–5, 5–15, 15–40, 40–80, and 80–100% of the narrative.
  strategist: { actWeighting: [5, 10, 25, 40, 20], weightingStrictness: 'soft' },
  explainer: { actWeighting: null, weightingStrictness: 'none' },
};
