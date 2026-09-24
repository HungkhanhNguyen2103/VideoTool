import type { ScriptPresetId } from '../../../../../contracts/project.js';

export const SCRIPT_PRESET_CONFIG: Record<ScriptPresetId, { actWeighting: number[] | null; weightingStrictness: 'strict' | 'soft' | 'none' }> = {
  documentary: { actWeighting: [8, 15, 55, 12, 10], weightingStrictness: 'soft' },
  'hubris-trap': { actWeighting: [8, 15, 55, 12, 10], weightingStrictness: 'strict' },
  explainer: { actWeighting: null, weightingStrictness: 'none' },
};
