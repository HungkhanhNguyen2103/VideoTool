import { describe, expect, it } from 'vitest';
import { kenBurnsTransform } from './frame-math';

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
