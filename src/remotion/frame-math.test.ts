import { describe, expect, it } from 'vitest';
import { kenBurnsTransform, sceneFrameTimings, sceneVisualTimings, totalDurationInFrames } from './frame-math';

describe('sceneVisualTimings', () => {
  it('extends outgoing images, fades in later scenes, and leaves audio starts and total length unchanged', () => {
    const scenes = [
      { id: 'a', assetType: 'image' as const, durationSec: 2 },
      { id: 'b', assetType: 'image' as const, durationSec: 2 },
      { id: 'c', assetType: 'video' as const, durationSec: 2 },
    ];
    expect(sceneVisualTimings(scenes, 30)).toEqual([
      { id: 'a', from: 0, durationInFrames: 75, fadeInFrames: 0 },
      { id: 'b', from: 60, durationInFrames: 75, fadeInFrames: 15 },
      { id: 'c', from: 120, durationInFrames: 60, fadeInFrames: 15 },
    ]);
    expect(sceneFrameTimings(scenes, 30)).toEqual([
      { id: 'a', from: 0, durationInFrames: 60 },
      { id: 'b', from: 60, durationInFrames: 60 },
      { id: 'c', from: 120, durationInFrames: 60 },
    ]);
    expect(totalDurationInFrames(scenes, 30)).toBe(180);
  });

  it('does not extend outgoing video and skips fading for a short incoming scene', () => {
    const scenes = [
      { id: 'video', assetType: 'video' as const, durationSec: 2 },
      { id: 'short', assetType: 'image' as const, durationSec: 1 },
      { id: 'last', assetType: 'image' as const, durationSec: 2 },
    ];
    expect(sceneVisualTimings(scenes, 30)).toEqual([
      { id: 'video', from: 0, durationInFrames: 60, fadeInFrames: 0 },
      { id: 'short', from: 60, durationInFrames: 45, fadeInFrames: 0 },
      { id: 'last', from: 90, durationInFrames: 60, fadeInFrames: 15 },
    ]);
  });

  it('uses half-second fades at the project frame rate', () => {
    const scenes = [
      { id: 'first', assetType: 'image' as const, durationSec: 2 },
      { id: 'second', assetType: 'image' as const, durationSec: 2 },
    ];
    expect(sceneVisualTimings(scenes, 24)).toEqual([
      { id: 'first', from: 0, durationInFrames: 60, fadeInFrames: 0 },
      { id: 'second', from: 48, durationInFrames: 48, fadeInFrames: 12 },
    ]);
  });
});

describe('kenBurnsTransform', () => {
  it('starts with no or minimal pan and a scale no larger than the gentle zoom range', () => {
    const start = kenBurnsTransform(0, 240, 'scene-a');
    expect(Math.abs(start.translateXPercent)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(start.translateYPercent)).toBeLessThanOrEqual(1.5);
    expect(start.scale).toBeGreaterThanOrEqual(1);
    expect(start.scale).toBeLessThanOrEqual(1.1);
  });

  it('makes one monotonic eased move over either a short or long scene', () => {
    for (const duration of [60, 240]) {
      const samples = [0, duration / 4, duration / 2, duration * 3 / 4, duration]
        .map((frame) => kenBurnsTransform(frame, duration, 'scene-a'));
      const scales = samples.map(({ scale }) => scale);
      const direction = Math.sign(scales.at(-1)! - scales[0]!);
      expect(direction).not.toBe(0);
      for (let i = 1; i < scales.length; i += 1) {
        expect((scales[i]! - scales[i - 1]!) * direction).toBeGreaterThanOrEqual(0);
      }
      expect(Math.abs(scales[1]! - scales[0]!)).toBeGreaterThan(Math.abs(scales[4]! - scales[3]!));
      expect(Math.abs(scales[4]! - scales[0]!)).toBeLessThanOrEqual(0.1);
    }
  });

  it('returns the same transform for the same seed and distinct motion for some seeds', () => {
    expect(kenBurnsTransform(90, 180, 'scene-a')).toEqual(kenBurnsTransform(90, 180, 'scene-a'));
    const variants = new Set(['scene-a', 'scene-b', 'scene-c', 'scene-d'].map((seed) => JSON.stringify(kenBurnsTransform(90, 180, seed))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('skips motion below 30 frames and clamps out-of-range frames', () => {
    expect(kenBurnsTransform(10, 29, 'scene-a')).toEqual({ scale: 1, translateXPercent: 0, translateYPercent: 0 });
    expect(kenBurnsTransform(-10, 60, 'scene-a')).toEqual(kenBurnsTransform(0, 60, 'scene-a'));
    expect(kenBurnsTransform(100, 60, 'scene-a')).toEqual(kenBurnsTransform(60, 60, 'scene-a'));
  });
});
