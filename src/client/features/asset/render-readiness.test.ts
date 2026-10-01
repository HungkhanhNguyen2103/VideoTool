import { describe, expect, it } from 'vitest';
import type { Scene } from '../../../contracts/project';
import { summarizeRenderReadiness } from './render-readiness';

function scene(overrides: Partial<Scene>): Scene {
  return {
    id: 'scene-1', narration: 'Scene', visualPrompt: '', durationSec: 5, assetType: 'image', assetFileId: 'image-1', audioFileId: null,
    sfxPrompt: '', motionPrompt: '', sfxFileId: null, videoKeyframeFileId: null, videoTailFileId: null, videoDurationSec: null,
    wordTimings: null, depthMap: null,
    ...overrides,
  };
}

describe('render readiness summary', () => {
  it('separates ready scenes, warnings, and hard blockers', () => {
    const summary = summarizeRenderReadiness([
      scene({ id: 'ready' }),
      scene({ id: 'cut', assetType: 'video', assetFileId: 'clip-1', videoDurationSec: 7 }),
      scene({ id: 'missing', assetType: 'video', assetFileId: null, videoKeyframeFileId: null }),
      scene({ id: 'keyframe', assetType: 'video', assetFileId: null, videoKeyframeFileId: 'keyframe-1' }),
    ]);

    expect(summary).toMatchObject({ total: 4, ready: 1, warnings: 1, errors: 2 });
    expect(summary.blockers.map((item) => item.sceneNumber)).toEqual([3, 4]);
    expect(summary.confirmations.map((item) => item.sceneNumber)).toEqual([2]);
    expect(summary.issues.map((item) => item.sceneNumber)).toEqual([2, 3, 4]);
  });
});
