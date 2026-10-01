import { describe, expect, it } from 'vitest';
import type { Scene } from './project';
import { analyzeScene } from './scene-readiness';

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-1',
    narration: 'Narration',
    visualPrompt: 'Visual',
    durationSec: 5,
    assetType: 'image',
    assetFileId: 'asset-1',
    audioFileId: 'audio-1',
    wordTimings: null,
    sfxPrompt: '',
    motionPrompt: '',
    sfxFileId: null,
    videoKeyframeFileId: null,
    videoTailFileId: null,
    videoDurationSec: null,
    depthMap: null,
    ...overrides,
  };
}

describe('analyzeScene', () => {
  it('returns image readiness and missing asset status without doing I/O', () => {
    expect(analyzeScene(makeScene({ assetType: 'image', assetFileId: null }))).toMatchObject({ kind: 'image', status: 'missing-asset' });
    expect(analyzeScene(makeScene({ assetType: 'image' }))).toMatchObject({ kind: 'image', status: 'ok', needsVoiceover: false });
  });

  it('reports every video asset state', () => {
    expect(analyzeScene(makeScene({ assetType: 'video', assetFileId: null, videoKeyframeFileId: null }))).toMatchObject({ status: 'missing-clip' });
    expect(analyzeScene(makeScene({ assetType: 'video', assetFileId: null, videoKeyframeFileId: 'keyframe-1' }))).toMatchObject({ status: 'keyframe-only' });
    expect(analyzeScene(makeScene({ assetType: 'video', videoDurationSec: null }))).toMatchObject({ status: 'clip-unmeasured' });
  });

  it('uses the epsilon boundary for clip cut warnings', () => {
    expect(analyzeScene(makeScene({ assetType: 'video', videoDurationSec: 5.04, videoTailFileId: 'tail-1' }))).toMatchObject({ status: 'ok' });
    expect(analyzeScene(makeScene({ assetType: 'video', videoDurationSec: 5.06 }))).toMatchObject({ status: 'clip-cut', deltaSec: 0.1 });
  });

  it('reports clip padding and its tail-frame fallback', () => {
    const result = analyzeScene(makeScene({ assetType: 'video', videoDurationSec: 3.2, videoKeyframeFileId: 'keyframe-1', videoTailFileId: null }));
    expect(result).toMatchObject({ status: 'clip-padded', deltaSec: 1.8 });
    expect(result.messages.join(' ')).toContain('khung keyframe');
  });

  it('reports no-tail when measured timing fits the scene', () => {
    expect(analyzeScene(makeScene({ assetType: 'video', videoDurationSec: 5, videoTailFileId: null }))).toMatchObject({ status: 'no-tail' });
    expect(analyzeScene(makeScene({ assetType: 'video', videoDurationSec: 5, videoTailFileId: 'tail-1' }))).toMatchObject({ status: 'ok' });
  });

  it('adds the voiceover estimate hint independently of readiness', () => {
    const result = analyzeScene(makeScene({ audioFileId: null }));
    expect(result.needsVoiceover).toBe(true);
    expect(result.messages).toContain('thoi luong scene la uoc tinh, tao voiceover de co thoi luong that');
  });
});
