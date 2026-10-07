import { describe, expect, it } from 'vitest';
import type { Scene } from '../../../contracts/project';
import { computePipelineProgress } from './pipeline-progress';

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    narration: `Scene ${id}`,
    visualPrompt: '',
    durationSec: 5,
    assetType: 'image',
    assetFileId: null,
    audioFileId: null,
    voiceoverDurationSec: null,
    wordTimings: null,
    sfxPrompt: '',
    motionPrompt: '',
    sfxFileId: null,
    videoKeyframeFileId: null,
    videoTailFileId: null,
    videoDurationSec: null,
    depthMap: null,
    nameCandidates: null,
    ...overrides,
  };
}

function project(scenes: Scene[], overrides: { draftRenderFileId?: string | null; renderFileId?: string | null } = {}) {
  return { scenes, draftRenderFileId: null, renderFileId: null, ...overrides } as never;
}

function step(result: ReturnType<typeof computePipelineProgress>, key: string) {
  return result.steps.find((candidate) => candidate.key === key)!;
}

describe('computePipelineProgress', () => {
  it('handles an empty project without throwing', () => {
    const result = computePipelineProgress(project([]));

    expect(result.percent).toBe(0);
    expect(result.steps).toMatchObject([
      { key: 'script', done: 0, total: 1, ratio: 0 },
      { key: 'visualPrompt', done: 0, total: 0, ratio: 0 },
      { key: 'assets', done: 0, total: 0, ratio: 0 },
      { key: 'voiceover', done: 0, total: 0, ratio: 0 },
      { key: 'sfx', done: 0, total: 0, ratio: 0 },
      { key: 'draft', done: 0, total: 1, ratio: 0 },
      { key: 'final', done: 0, total: 1, ratio: 0 },
    ]);
  });

  it('counts script completion when scenes exist', () => {
    expect(computePipelineProgress(project([scene('1')])).percent).toBe(10);
  });

  it('calculates all scene steps at 75 percent before either render exists', () => {
    const scenes = [scene('1', { visualPrompt: 'one', assetFileId: 'image-1', audioFileId: 'voice-1', sfxFileId: 'sfx-1' })];

    expect(computePipelineProgress(project(scenes)).percent).toBe(75);
  });

  it('reaches 100 percent when every step is complete', () => {
    const scenes = [scene('1', { visualPrompt: 'one', assetFileId: 'image-1', audioFileId: 'voice-1', sfxFileId: 'sfx-1' })];

    expect(computePipelineProgress(project(scenes, { draftRenderFileId: 'draft-1', renderFileId: 'final-1' })).percent).toBe(100);
  });

  it('does not count a video scene with only a keyframe as asset-complete', () => {
    const result = computePipelineProgress(project([scene('1', { assetType: 'video', videoKeyframeFileId: 'keyframe-1' })]));

    expect(step(result, 'assets')).toMatchObject({ done: 0, total: 1, ratio: 0 });
  });

  it('counts clip-cut and clip-padded scenes as asset-complete warnings', () => {
    const result = computePipelineProgress(project([
      scene('cut', { assetType: 'video', assetFileId: 'clip-1', durationSec: 5, videoDurationSec: 6 }),
      scene('padded', { assetType: 'video', assetFileId: 'clip-2', durationSec: 5, videoDurationSec: 4 }),
    ]));

    expect(step(result, 'assets')).toMatchObject({ done: 2, total: 2, ratio: 1 });
  });

  it('rounds weighted fractional progress to the nearest whole percent', () => {
    const result = computePipelineProgress(project([
      scene('1', { visualPrompt: 'one', assetFileId: 'image-1', audioFileId: 'voice-1', sfxFileId: 'sfx-1' }),
      scene('2', { visualPrompt: '', assetFileId: 'image-2', audioFileId: 'voice-2' }),
      scene('3'),
    ]));

    expect(result.percent).toBe(48);
  });
});
