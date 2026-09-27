import { describe, expect, it } from 'vitest';
import { kenBurnsTransform, planTransitions, sceneFrameTimings, sceneVisualTimings, totalDurationInFrames } from './frame-math';

describe('sceneVisualTimings', () => {
  it('extends outgoing images, fades in later scenes, and leaves audio starts and total length unchanged', () => {
    const scenes = [
      { id: 'a', assetType: 'image' as const, durationSec: 2 },
      { id: 'b', assetType: 'image' as const, durationSec: 2 },
      { id: 'c', assetType: 'video' as const, durationSec: 2 },
    ];
    expect(sceneVisualTimings(scenes, 30, 'crossfade')).toEqual([
      { id: 'a', from: 0, durationInFrames: 75, fadeInFrames: 0, incomingTransition: null, outgoingTransition: { type: 'crossfade', frames: 15 } },
      { id: 'b', from: 60, durationInFrames: 75, fadeInFrames: 15, incomingTransition: { type: 'crossfade', frames: 15 }, outgoingTransition: { type: 'crossfade', frames: 15 } },
      { id: 'c', from: 120, durationInFrames: 60, fadeInFrames: 15, incomingTransition: { type: 'crossfade', frames: 15 }, outgoingTransition: null },
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
    expect(sceneVisualTimings(scenes, 30, 'crossfade')).toEqual([
      { id: 'video', from: 0, durationInFrames: 60, fadeInFrames: 0, incomingTransition: null, outgoingTransition: { type: 'crossfade', frames: 0 } },
      { id: 'short', from: 60, durationInFrames: 45, fadeInFrames: 0, incomingTransition: { type: 'crossfade', frames: 0 }, outgoingTransition: { type: 'crossfade', frames: 15 } },
      { id: 'last', from: 90, durationInFrames: 60, fadeInFrames: 15, incomingTransition: { type: 'crossfade', frames: 15 }, outgoingTransition: null },
    ]);
  });

  it('uses half-second fades at the project frame rate', () => {
    const scenes = [
      { id: 'first', assetType: 'image' as const, durationSec: 2 },
      { id: 'second', assetType: 'image' as const, durationSec: 2 },
    ];
    expect(sceneVisualTimings(scenes, 24, 'crossfade')).toEqual([
      { id: 'first', from: 0, durationInFrames: 60, fadeInFrames: 0, incomingTransition: null, outgoingTransition: { type: 'crossfade', frames: 12 } },
      { id: 'second', from: 48, durationInFrames: 48, fadeInFrames: 12, incomingTransition: { type: 'crossfade', frames: 12 }, outgoingTransition: null },
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

describe('planTransitions', () => {
  const scenes = Array.from({ length: 201 }, (_, index) => ({
    id: `scene-${index}`,
    assetType: 'image' as const,
    durationSec: 5,
  }));

  it('is deterministic, weighted approximately, and never repeats a type at adjacent boundaries', () => {
    const first = planTransitions(scenes, 30, 'varied');
    const second = planTransitions(scenes, 30, 'varied');
    expect(first).toEqual(second);
    expect(first).toHaveLength(200);
    for (let index = 1; index < first.length; index += 1) expect(first[index]!.type).not.toBe(first[index - 1]!.type);
    const counts = Object.fromEntries(['crossfade', 'wipe', 'whipPan', 'zoomThrough', 'lightLeak', 'filmBurn'].map((type) => [type, first.filter((plan) => plan.type === type).length]));
    expect(counts.crossfade).toBeGreaterThanOrEqual(45);
    expect(counts.crossfade).toBeLessThanOrEqual(110);
    for (const type of ['wipe', 'whipPan', 'zoomThrough', 'lightLeak', 'filmBurn']) {
      expect(counts[type]).toBeGreaterThanOrEqual(8);
      expect(counts[type]).toBeLessThanOrEqual(60);
    }
  });

  it('forces crossfade for outgoing video and honors the crossfade style override', () => {
    const scenesWithVideo = [
      { id: 'first', assetType: 'video' as const, durationSec: 5 },
      { id: 'second', assetType: 'image' as const, durationSec: 5 },
      { id: 'third', assetType: 'image' as const, durationSec: 5 },
    ];
    expect(planTransitions(scenesWithVideo, 30, 'varied')[0]).toEqual({ type: 'crossfade', frames: 15 });
    expect(planTransitions(scenesWithVideo, 30, 'crossfade').every((plan) => plan.type === 'crossfade')).toBe(true);
  });

  it('falls back to crossfade for a short scene, then to a hard cut when no transition fits', () => {
    const fallback = planTransitions([
      { id: 'first', assetType: 'image' as const, durationSec: 5 },
      { id: 'short', assetType: 'image' as const, durationSec: 1.6 },
    ], 30, 'varied')[0]!;
    expect(fallback).toEqual({ type: 'crossfade', frames: 15 });
    const cut = planTransitions([
      { id: 'first', assetType: 'image' as const, durationSec: 5 },
      { id: 'tiny', assetType: 'image' as const, durationSec: .5 },
    ], 30, 'varied')[0]!;
    expect(cut).toEqual({ type: 'crossfade', frames: 0 });
  });

  it('leaves audio starts and total duration unchanged when varied visuals are planned', () => {
    const audioScenes = [
      { id: 'one', assetType: 'image' as const, durationSec: 1.25 },
      { id: 'two', assetType: 'image' as const, durationSec: 2.5 },
      { id: 'three', assetType: 'image' as const, durationSec: 1.75 },
    ];
    const visual = sceneVisualTimings(audioScenes, 30, 'varied');
    expect(visual.map(({ id, from }) => ({ id, from }))).toEqual([
      { id: 'one', from: 0 }, { id: 'two', from: 38 }, { id: 'three', from: 113 },
    ]);
    expect(totalDurationInFrames(audioScenes, 30)).toBe(165);
  });
});
